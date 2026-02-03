import { useCallback, useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTerminal } from "./useTerminal";
import "xterm/css/xterm.css";
import "./Terminal.css";

interface TerminalProps {
  className?: string;
  cwd?: string;
  shell?: string;
  tabId?: string;
  onStatusChange?: (status: 'ready' | 'busy' | 'idle' | 'exited') => void;
}

export function Terminal({ className = "", cwd, shell, tabId, onStatusChange }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isInitializedRef = useRef(false);
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

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
    shell,
  });

  // Store functions in refs to avoid stale closures
  const writeTerminalRef = useRef(writeTerminal);
  const resizeTerminalRef = useRef(resizeTerminal);
  writeTerminalRef.current = writeTerminal;
  resizeTerminalRef.current = resizeTerminal;

  // Initialize xterm.js and connect to PTY
  useEffect(() => {
    if (!terminalRef.current || isInitializedRef.current) return;
    isInitializedRef.current = true;

    // Create terminal instance
    const xterm = new XTerm({
      theme: {
        background: "#1a1a1a",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        cursorAccent: "#1a1a1a",
        selectionBackground: "#3a3a3a",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
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
    xterm.open(terminalRef.current);
    fitAddon.fit();

    // Store refs
    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Connect user input to PTY
    const onDataDisposable = xterm.onData((data) => {
      writeTerminalRef.current(data);
    });

    // Send resize events when terminal dimensions change
    const onResizeDisposable = xterm.onResize(({ rows, cols }) => {
      resizeTerminalRef.current(rows, cols);
    });

    // Handle window resize
    const handleWindowResize = () => {
      fitAddon.fit();
    };
    window.addEventListener("resize", handleWindowResize);

    // Create the PTY session
    createTerminal().then(() => {
      // Send initial size after connection
      const { rows, cols } = xterm;
      resizeTerminalRef.current(rows, cols);
      // Signal ready status
      onStatusChangeRef.current?.('ready');
    });

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }
      destroyTerminal();
    };
  }, [createTerminal, destroyTerminal]);

  // Re-fit on container resize
  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  return (
    <div className={`terminal-container ${className}`.trim()}>
      <div ref={terminalRef} className="terminal-content" />
      {!isConnected && (
        <div className="terminal-status">Connecting...</div>
      )}
    </div>
  );
}
