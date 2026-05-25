use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, PtyPair, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

/// Event emitted when terminal produces output
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub id: String,
    pub data: String,
}

/// Event emitted when terminal exits
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub id: String,
    pub exit_code: Option<i32>,
}

/// A terminal session wrapping a pseudo-terminal
pub struct TerminalSession {
    pty_pair: PtyPair,
    writer: Box<dyn Write + Send>,
    /// Child process handle for retrieving exit code
    child: Option<Box<dyn PtyChild + Send + Sync>>,
    /// Stop signal sender for the reader thread (set when streaming is started)
    stop_signal: Option<Sender<()>>,
}

impl TerminalSession {
    /// Create a new terminal session with the specified shell and working directory
    pub fn new(shell: Option<String>, cwd: Option<String>) -> Result<Self, String> {
        let pty_system = native_pty_system();

        // Default terminal size
        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pty_pair = pty_system
            .openpty(size)
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Build the shell command
        let mut cmd = if let Some(shell_path) = shell {
            CommandBuilder::new(shell_path)
        } else {
            // Platform-specific default shell
            #[cfg(windows)]
            {
                CommandBuilder::new("powershell.exe")
            }
            #[cfg(not(windows))]
            {
                CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()))
            }
        };

        // Set working directory if specified
        if let Some(working_dir) = cwd {
            cmd.cwd(working_dir);
        }

        // Spawn the shell process
        let child = pty_pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        // Get the writer for sending input to the terminal
        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        Ok(Self {
            pty_pair,
            writer,
            child: Some(child),
            stop_signal: None,
        })
    }

    /// Write data to the terminal
    pub fn write(&mut self, data: &str) -> Result<(), String> {
        self.writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
        self.writer
            .flush()
            .map_err(|e| format!("Failed to flush PTY: {}", e))?;
        Ok(())
    }

    /// Resize the terminal
    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        self.pty_pair
            .master
            .resize(size)
            .map_err(|e| format!("Failed to resize PTY: {}", e))
    }

    /// Take the reader for output streaming (can only be called once)
    pub fn take_reader(&self) -> Result<Box<dyn Read + Send>, String> {
        self.pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {}", e))
    }

    /// Set the stop signal sender for cleanup
    pub fn set_stop_signal(&mut self, sender: Sender<()>) {
        self.stop_signal = Some(sender);
    }

    /// Take the child process handle (for retrieving exit code)
    pub fn take_child(&mut self) -> Option<Box<dyn PtyChild + Send + Sync>> {
        self.child.take()
    }

    /// Signal the reader thread to stop
    pub fn stop_reader(&mut self) {
        if let Some(sender) = self.stop_signal.take() {
            let _ = sender.send(());
        }
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        // Signal reader thread to stop
        self.stop_reader();
    }
}

/// Global terminal manager singleton
static TERMINAL_MANAGER: OnceLock<Arc<Mutex<TerminalManager>>> = OnceLock::new();

/// Manages multiple terminal sessions
pub struct TerminalManager {
    sessions: HashMap<String, TerminalSession>,
}

impl TerminalManager {
    /// Create a new terminal manager
    fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Create a new terminal session with the given ID
    pub fn create_session(
        &mut self,
        id: String,
        shell: Option<String>,
        cwd: Option<String>,
    ) -> Result<(), String> {
        if self.sessions.contains_key(&id) {
            return Err(format!("Terminal session '{}' already exists", id));
        }

        log::info!("Creating terminal session '{}'", id);
        let session = TerminalSession::new(shell, cwd)?;
        self.sessions.insert(id.clone(), session);
        log::info!("Terminal session '{}' created successfully", id);
        Ok(())
    }

    /// Get a mutable reference to a terminal session
    pub fn get_session_mut(&mut self, id: &str) -> Option<&mut TerminalSession> {
        self.sessions.get_mut(id)
    }

    /// Get an immutable reference to a terminal session
    pub fn get_session(&self, id: &str) -> Option<&TerminalSession> {
        self.sessions.get(id)
    }

    /// Remove and return a terminal session
    pub fn remove_session(&mut self, id: &str) -> Option<TerminalSession> {
        log::info!("Removing terminal session '{}'", id);
        let session = self.sessions.remove(id);
        if session.is_some() {
            log::info!("Terminal session '{}' removed", id);
        }
        session
    }
}

/// Get the global terminal manager instance
pub fn get_terminal_manager() -> Arc<Mutex<TerminalManager>> {
    TERMINAL_MANAGER
        .get_or_init(|| Arc::new(Mutex::new(TerminalManager::new())))
        .clone()
}

/// Start the output reader thread for a terminal session
pub fn start_output_reader(
    id: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    log::info!("Starting output reader for terminal '{}'", id);

    let manager = get_terminal_manager();
    let mut guard = manager.lock().map_err(|e| format!("Lock error: {}", e))?;

    let session = guard
        .get_session_mut(&id)
        .ok_or_else(|| format!("Terminal session '{}' not found", id))?;

    // Get the reader from the session
    let mut reader = session.take_reader()?;

    // Create stop signal channel
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    session.set_stop_signal(stop_tx);

    // Clone id for the thread
    let thread_id = id.clone();

    // Spawn reader thread
    std::thread::spawn(move || {
        log::info!("Reader thread started for terminal '{}'", thread_id);
        let mut buffer = [0u8; 4096];
        // Trailing bytes from a multi-byte UTF-8 sequence that landed across a
        // read boundary. Prepended to the next read so split codepoints don't
        // get mojibake'd into U+FFFD.
        let mut leftover: Vec<u8> = Vec::with_capacity(8);
        // Coalesce buffer — flushed every FLUSH_INTERVAL or at FLUSH_SIZE_BYTES.
        // Stops PowerShell tab-completion from firing hundreds of IPC events.
        let mut pending = String::new();
        let mut last_flush = std::time::Instant::now();
        let mut was_stopped = false;
        // Coalesce window. Short enough that keystroke echo / shell prompts feel
        // immediate (~4ms floor), but the 64KB size threshold below still bounds
        // IPC volume during bursts (tab-completion, file dumps). See #264.
        const FLUSH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(4);
        const FLUSH_SIZE_BYTES: usize = 64 * 1024;

        loop {
            // Check for stop signal (non-blocking)
            if stop_rx.try_recv().is_ok() {
                log::info!("Reader thread for '{}' received stop signal", thread_id);
                was_stopped = true;
                break;
            }

            let mut is_would_block = false;
            let mut should_break = false;

            match reader.read(&mut buffer) {
                Ok(0) => {
                    log::info!("Terminal '{}' EOF reached", thread_id);
                    // Flush any incomplete UTF-8 leftover lossily — residual partial
                    // bytes at EOF are genuine garbage and U+FFFD is the correct rendering.
                    if !leftover.is_empty() {
                        pending.push_str(&String::from_utf8_lossy(&leftover));
                        leftover.clear();
                    }
                    // Final emit of any pending bytes BEFORE the exit-event logic below.
                    if !pending.is_empty() {
                        let event = TerminalOutputEvent {
                            id: thread_id.clone(),
                            data: std::mem::take(&mut pending),
                        };
                        if let Err(e) = app_handle.emit("terminal-output", event) {
                            log::error!("Failed to emit terminal-output event: {}", e);
                        }
                    }
                    should_break = true;
                }
                Ok(n) => {
                    // Combine any leftover from the previous read with the freshly read
                    // bytes, then peel off the longest valid-UTF-8 prefix.
                    let combined: Vec<u8> = if leftover.is_empty() {
                        buffer[..n].to_vec()
                    } else {
                        let mut c = std::mem::take(&mut leftover);
                        c.extend_from_slice(&buffer[..n]);
                        c
                    };

                    match std::str::from_utf8(&combined) {
                        Ok(s) => pending.push_str(s),
                        Err(e) => {
                            let valid_up_to = e.valid_up_to();
                            // SAFETY: bytes[..valid_up_to] is guaranteed valid UTF-8
                            // by the Utf8Error contract.
                            let valid = unsafe {
                                std::str::from_utf8_unchecked(&combined[..valid_up_to])
                            };
                            pending.push_str(valid);
                            match e.error_len() {
                                None => {
                                    // Incomplete multi-byte sequence at end — carry over.
                                    leftover.extend_from_slice(&combined[valid_up_to..]);
                                }
                                Some(_) => {
                                    // Genuine mid-stream garbage — lossy-replace this chunk's remainder.
                                    // Don't try to carry over after mid-stream garbage; recovery is best-effort.
                                    pending.push_str(&String::from_utf8_lossy(&combined[valid_up_to..]));
                                }
                            }
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    is_would_block = true;
                }
                Err(e) => {
                    log::error!("Error reading from PTY '{}': {}", thread_id, e);
                    should_break = true;
                }
            }

            if should_break {
                break;
            }

            // Flush coalesce buffer if interval elapsed or size threshold met.
            // MUST run before the WouldBlock sleep — otherwise idle periods after
            // a burst would leave the final chunk stuck waiting for more output.
            if !pending.is_empty()
                && (last_flush.elapsed() >= FLUSH_INTERVAL || pending.len() >= FLUSH_SIZE_BYTES)
            {
                let event = TerminalOutputEvent {
                    id: thread_id.clone(),
                    data: std::mem::take(&mut pending),
                };
                if let Err(e) = app_handle.emit("terminal-output", event) {
                    log::error!("Failed to emit terminal-output event: {}", e);
                }
                last_flush = std::time::Instant::now();
            }

            // Only sleep on WouldBlock — non-WouldBlock iterations loop immediately
            // to drain large bursts (tab completion, file dumps) as fast as possible.
            // Adaptive nap (#264): a short 2ms when bytes are still pending (the next
            // flush is imminent — keep echo latency low) vs 8ms when truly idle (keep
            // idle CPU low instead of busy-spinning).
            if is_would_block {
                let nap = if pending.is_empty() { 8 } else { 2 };
                std::thread::sleep(std::time::Duration::from_millis(nap));
            }
        }

        // Emit terminal-exit event (unless manually stopped via destroy_terminal)
        if !was_stopped {
            // Retrieve exit code from the child process handle
            let exit_code = {
                let manager = get_terminal_manager();
                let mut child = manager
                    .lock()
                    .ok()
                    .and_then(|mut guard| {
                        guard.get_session_mut(&thread_id)
                            .and_then(|session| session.take_child())
                    });
                // Process already exited (EOF reached), so wait() returns immediately
                child.as_mut().and_then(|c| {
                    match c.wait() {
                        Ok(status) => Some(status.exit_code() as i32),
                        Err(e) => {
                            log::warn!("Failed to get exit code for '{}': {}", thread_id, e);
                            None
                        }
                    }
                })
            };

            log::info!("Emitting terminal-exit event for '{}' (exit_code: {:?})", thread_id, exit_code);
            let exit_event = TerminalExitEvent {
                id: thread_id.clone(),
                exit_code,
            };

            if let Err(e) = app_handle.emit("terminal-exit", exit_event) {
                log::error!("Failed to emit terminal-exit event: {}", e);
            }

            // Auto-cleanup the session from the manager
            let manager = get_terminal_manager();
            let _ = manager.lock().map(|mut guard| {
                guard.remove_session(&thread_id);
            });
        }

        log::info!("Reader thread for '{}' exiting", thread_id);
    });

    log::info!("Output reader started for terminal '{}'", id);
    Ok(())
}
