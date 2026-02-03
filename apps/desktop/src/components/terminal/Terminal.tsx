import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "xterm/css/xterm.css";
import "./Terminal.css";

interface TerminalProps {
  className?: string;
}

export function Terminal({ className = "" }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

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

    // Write welcome message
    xterm.writeln("\x1b[1;36m╔════════════════════════════════════════╗\x1b[0m");
    xterm.writeln("\x1b[1;36m║\x1b[0m  \x1b[1;33mTiki Terminal\x1b[0m - Ready for PTY        \x1b[1;36m║\x1b[0m");
    xterm.writeln("\x1b[1;36m╚════════════════════════════════════════╝\x1b[0m");
    xterm.writeln("");
    xterm.writeln("\x1b[90mxterm.js initialized successfully.\x1b[0m");
    xterm.writeln("\x1b[90mPTY integration coming in future issues.\x1b[0m");
    xterm.writeln("");

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Re-fit on container resize
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });

    if (terminalRef.current) {
      observer.observe(terminalRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div className={`terminal-container ${className}`.trim()}>
      <div ref={terminalRef} className="terminal-content" />
    </div>
  );
}
