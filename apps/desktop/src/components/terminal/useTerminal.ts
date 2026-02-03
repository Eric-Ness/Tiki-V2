import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Types matching Rust backend events
export interface TerminalOutputEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  exitCode: number | null;
}

export interface UseTerminalOptions {
  onOutput?: (data: string) => void;
  onExit?: (exitCode: number | null) => void;
  shell?: string;
  cwd?: string;
  externalId?: string;
}

export interface UseTerminalReturn {
  terminalId: string | null;
  isConnected: boolean;
  error: string | null;
  createTerminal: () => Promise<void>;
  writeTerminal: (data: string) => Promise<void>;
  resizeTerminal: (rows: number, cols: number) => Promise<void>;
  destroyTerminal: () => Promise<void>;
}

let terminalCounter = 0;

export function useTerminal(options: UseTerminalOptions = {}): UseTerminalReturn {
  const { onOutput, onExit, shell, cwd, externalId } = options;

  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store callbacks in refs to avoid re-subscribing on every render
  const onOutputRef = useRef(onOutput);
  const onExitRef = useRef(onExit);
  onOutputRef.current = onOutput;
  onExitRef.current = onExit;

  // Store unlisten functions for cleanup
  const unlistenOutputRef = useRef<UnlistenFn | null>(null);
  const unlistenExitRef = useRef<UnlistenFn | null>(null);
  const currentIdRef = useRef<string | null>(null);

  // Create a new terminal session
  const createTerminal = useCallback(async () => {
    try {
      setError(null);

      // Use external ID if provided, otherwise generate one
      const id = externalId ?? `terminal-${Date.now()}-${++terminalCounter}`;
      currentIdRef.current = id;

      // Set up event listeners before creating terminal
      unlistenOutputRef.current = await listen<TerminalOutputEvent>(
        "terminal-output",
        (event) => {
          if (event.payload.id === currentIdRef.current) {
            onOutputRef.current?.(event.payload.data);
          }
        }
      );

      unlistenExitRef.current = await listen<TerminalExitEvent>(
        "terminal-exit",
        (event) => {
          if (event.payload.id === currentIdRef.current) {
            setIsConnected(false);
            onExitRef.current?.(event.payload.exitCode);
          }
        }
      );

      // Create the terminal session
      await invoke("create_terminal", {
        id,
        shell: shell ?? null,
        cwd: cwd ?? null,
      });

      setTerminalId(id);
      setIsConnected(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setIsConnected(false);

      // Clean up listeners on error
      unlistenOutputRef.current?.();
      unlistenExitRef.current?.();
      unlistenOutputRef.current = null;
      unlistenExitRef.current = null;
    }
  }, [shell, cwd, externalId]);

  // Write data to the terminal
  const writeTerminal = useCallback(async (data: string) => {
    if (!currentIdRef.current) {
      return;
    }

    try {
      await invoke("write_terminal", {
        id: currentIdRef.current,
        data,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }, []);

  // Resize the terminal
  const resizeTerminal = useCallback(async (rows: number, cols: number) => {
    if (!currentIdRef.current) {
      return;
    }

    try {
      await invoke("resize_terminal", {
        id: currentIdRef.current,
        rows,
        cols,
      });
    } catch (err) {
      // Resize errors are non-critical, just log them
      console.warn("Failed to resize terminal:", err);
    }
  }, []);

  // Destroy the terminal session
  const destroyTerminal = useCallback(async () => {
    const id = currentIdRef.current;
    if (!id) {
      return;
    }

    // Clean up listeners first
    unlistenOutputRef.current?.();
    unlistenExitRef.current?.();
    unlistenOutputRef.current = null;
    unlistenExitRef.current = null;

    try {
      await invoke("destroy_terminal", { id });
    } catch (err) {
      // Terminal may already be destroyed, ignore errors
      console.warn("Failed to destroy terminal:", err);
    }

    currentIdRef.current = null;
    setTerminalId(null);
    setIsConnected(false);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      // Async cleanup - fire and forget
      const id = currentIdRef.current;
      if (id) {
        invoke("destroy_terminal", { id }).catch(() => {
          // Ignore cleanup errors
        });
      }

      unlistenOutputRef.current?.();
      unlistenExitRef.current?.();
    };
  }, []);

  return {
    terminalId,
    isConnected,
    error,
    createTerminal,
    writeTerminal,
    resizeTerminal,
    destroyTerminal,
  };
}
