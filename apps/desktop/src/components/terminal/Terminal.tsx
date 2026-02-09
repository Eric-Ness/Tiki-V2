import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTerminal } from "./useTerminal";
import { terminalFocusRegistry } from "../../stores/terminalStore";
import { useSettingsStore } from "../../stores";
import type { ITheme } from "xterm";
import "xterm/css/xterm.css";
import "./Terminal.css";

// --- Terminal theme definitions ---

const DARK_TERMINAL_THEME: ITheme = {
  background: "#1e1e1e",
  foreground: "#cccccc",
  cursor: "#aeafad",
  cursorAccent: "#1e1e1e",
  selectionBackground: "#264f78",
  selectionForeground: "#ffffff",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

const LIGHT_TERMINAL_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#383a42",
  cursor: "#526eff",
  cursorAccent: "#ffffff",
  selectionBackground: "#add6ff",
  selectionForeground: "#000000",
  black: "#000000",
  red: "#e45649",
  green: "#50a14f",
  yellow: "#c18401",
  blue: "#4078f2",
  magenta: "#a626a4",
  cyan: "#0184bc",
  white: "#a0a1a7",
  brightBlack: "#4f525e",
  brightRed: "#e06c75",
  brightGreen: "#98c379",
  brightYellow: "#e5c07b",
  brightBlue: "#61afef",
  brightMagenta: "#c678dd",
  brightCyan: "#56b6c2",
  brightWhite: "#ffffff",
};

/** Resolve 'system' theme preference to 'dark' or 'light' */
function getEffectiveTheme(theme: 'dark' | 'light' | 'system'): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

interface TerminalProps {
  className?: string;
  cwd?: string;
  shell?: string;
  terminalId?: string;
  onStatusChange?: (status: 'ready' | 'busy' | 'idle' | 'exited') => void;
}

export function Terminal({ className = "", cwd, shell, terminalId, onStatusChange }: TerminalProps) {
  // Settings
  const terminalSettings = useSettingsStore((s) => s.terminal);
  const themeSetting = useSettingsStore((s) => s.appearance.theme);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isInitializedRef = useRef(false);
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // Track when container becomes visible (has dimensions)
  const [isVisible, setIsVisible] = useState(false);

  // Callbacks for terminal output and exit
  const handleOutput = useCallback((data: string) => {
    xtermRef.current?.write(data);

    // Signal busy status on output, debounce to idle
    onStatusChangeRef.current?.('busy');
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
    }
    idleTimeoutRef.current = setTimeout(() => {
      onStatusChangeRef.current?.('idle');
    }, 500);
  }, []);

  const handleExit = useCallback((exitCode: number | null) => {
    const xterm = xtermRef.current;
    if (xterm) {
      xterm.writeln("");
      xterm.writeln(
        `\x1b[90m[Process exited${exitCode !== null ? ` with code ${exitCode}` : ""}]\x1b[0m`
      );
    }
    onStatusChangeRef.current?.('exited');
  }, []);

  const {
    isConnected,
    createTerminal,
    writeTerminal,
    resizeTerminal,
    destroyTerminal,
  } = useTerminal({
    onOutput: handleOutput,
    onExit: handleExit,
    cwd,
    shell: shell ?? (terminalSettings.defaultShell || undefined),
    externalId: terminalId,
  });

  // Store functions in refs to avoid stale closures
  const writeTerminalRef = useRef(writeTerminal);
  const resizeTerminalRef = useRef(resizeTerminal);
  const createTerminalRef = useRef(createTerminal);
  const destroyTerminalRef = useRef(destroyTerminal);
  writeTerminalRef.current = writeTerminal;
  resizeTerminalRef.current = resizeTerminal;
  createTerminalRef.current = createTerminal;
  destroyTerminalRef.current = destroyTerminal;

  // Watch for container visibility
  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const hasSize = container.offsetWidth > 0 && container.offsetHeight > 0;
      if (hasSize && !isVisible) {
        setIsVisible(true);
      }
      // Fit existing terminal if it exists
      if (hasSize && xtermRef.current) {
        fitAddonRef.current?.fit();
      }
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, [isVisible]);

  // Initialize xterm.js and connect to PTY when visible
  useEffect(() => {
    if (!terminalRef.current || !isVisible || isInitializedRef.current) return;

    const container = terminalRef.current;

    // Double-check dimensions
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      return;
    }

    isInitializedRef.current = true;

    // Use double RAF to ensure DOM is fully laid out
    let cancelled = false;
    requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;

        // Final dimension check
        if (container.offsetWidth === 0 || container.offsetHeight === 0) {
          isInitializedRef.current = false;
          return;
        }

        // Create terminal instance with theme matching app setting
        const currentTheme = getEffectiveTheme(useSettingsStore.getState().appearance.theme);
        const xterm = new XTerm({
          theme: currentTheme === 'dark' ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME,
          fontFamily: terminalSettings.fontFamily,
          fontSize: terminalSettings.fontSize,
          scrollback: terminalSettings.scrollbackBuffer,
          lineHeight: 1.2,
          cursorBlink: true,
          cursorStyle: "block",
        });

        // Add addons
        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();
        xterm.loadAddon(fitAddon);
        xterm.loadAddon(webLinksAddon);

        // Open terminal in container
        xterm.open(container);

        // Fit after a small delay to ensure rendering is complete
        setTimeout(() => {
          if (!cancelled && container.offsetWidth > 0 && container.offsetHeight > 0) {
            fitAddon.fit();
          }
        }, 10);

        // Store refs
        xtermRef.current = xterm;
        fitAddonRef.current = fitAddon;

        // Register focus function so other components can focus this terminal
        if (terminalId) {
          terminalFocusRegistry.register(terminalId, () => xterm.focus());
        }

        // Handle copy/paste keyboard shortcuts
        xterm.attachCustomKeyEventHandler((e: KeyboardEvent) => {
          // Ctrl+Shift+C: Copy selection to clipboard
          if (e.ctrlKey && e.shiftKey && e.key === 'C' && e.type === 'keydown') {
            const selection = xterm.getSelection();
            if (selection) {
              navigator.clipboard.writeText(selection);
            }
            return false; // Prevent xterm from processing
          }

          // Ctrl+Shift+V: Paste from clipboard
          if (e.ctrlKey && e.shiftKey && e.key === 'V' && e.type === 'keydown') {
            navigator.clipboard.readText().then((text) => {
              if (text) {
                xterm.paste(text);
              }
            });
            return false; // Prevent xterm from processing
          }

          return true; // Let xterm handle all other keys
        });

        // Connect user input to PTY
        xterm.onData((data) => {
          writeTerminalRef.current(data);
        });

        // Send resize events when terminal dimensions change
        xterm.onResize(({ rows, cols }) => {
          resizeTerminalRef.current(rows, cols);
        });

        // Handle window resize
        const handleWindowResize = () => {
          if (container.offsetWidth > 0 && container.offsetHeight > 0) {
            fitAddon.fit();
          }
        };
        window.addEventListener("resize", handleWindowResize);

        // Create the PTY session
        createTerminalRef.current().then(() => {
          if (cancelled) return;
          // Send initial size after connection
          const { rows, cols } = xterm;
          resizeTerminalRef.current(rows, cols);
          // Signal ready status
          onStatusChangeRef.current?.('ready');
        });
      });
    });

    // Cleanup
    return () => {
      cancelled = true;
      if (terminalId) {
        terminalFocusRegistry.unregister(terminalId);
      }
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
      fitAddonRef.current = null;
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }
      destroyTerminalRef.current();
    };
  }, [isVisible]);

  // Update xterm theme when the app theme setting changes
  useEffect(() => {
    const applyTheme = (effective: 'dark' | 'light') => {
      const xterm = xtermRef.current;
      if (xterm) {
        xterm.options.theme = effective === 'dark' ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
      }
    };

    // Apply the theme immediately for the current setting
    applyTheme(getEffectiveTheme(themeSetting));

    // If the user chose 'system', listen for OS-level preference changes
    if (themeSetting === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? 'dark' : 'light');
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [themeSetting]);

  return (
    <div className={`terminal-container ${className}`.trim()}>
      <div ref={terminalRef} className="terminal-content" />
      {!isConnected && (
        <div className="terminal-status">Connecting...</div>
      )}
    </div>
  );
}
