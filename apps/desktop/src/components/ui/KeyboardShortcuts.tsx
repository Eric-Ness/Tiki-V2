import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./KeyboardShortcuts.css";

// --- Shortcut data types ---

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

// --- All keyboard shortcuts grouped by area ---

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "General",
    shortcuts: [
      { keys: ["Ctrl", "K"], description: "Open command palette" },
      { keys: ["Ctrl", "/"], description: "Open keyboard shortcuts" },
      { keys: ["Ctrl", ","], description: "Open settings" },
      { keys: ["Esc"], description: "Close dialog / overlay" },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["Ctrl", "1"], description: "Switch to Terminal view" },
      { keys: ["Ctrl", "2"], description: "Switch to Kanban view" },
    ],
  },
  {
    title: "Terminal",
    shortcuts: [
      { keys: ["Ctrl", "T"], description: "New terminal tab" },
      { keys: ["Ctrl", "W"], description: "Close current tab" },
      { keys: ["Ctrl", "Tab"], description: "Next terminal tab" },
      { keys: ["Ctrl", "Shift", "Tab"], description: "Previous terminal tab" },
      { keys: ["Ctrl", "Shift", "H"], description: "Split terminal horizontally" },
      { keys: ["Ctrl", "Shift", "\\"], description: "Split terminal vertically" },
    ],
  },
  {
    title: "Command Palette",
    shortcuts: [
      { keys: ["\u2191", "\u2193"], description: "Navigate items" },
      { keys: ["Enter"], description: "Select item" },
      { keys: ["Esc"], description: "Close palette" },
    ],
  },
];

// --- Key cap component ---

function KeyCap({ label }: { label: string }) {
  return <kbd className="keyboard-shortcuts-key">{label}</kbd>;
}

// --- Component ---

interface KeyboardShortcutsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcuts({ isOpen, onClose }: KeyboardShortcutsProps) {
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="keyboard-shortcuts-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={handleOverlayClick}
          onKeyDown={handleKeyDown}
          tabIndex={-1}
        >
          <motion.div
            className="keyboard-shortcuts-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {/* Header */}
            <div className="keyboard-shortcuts-header">
              <h2>Keyboard Shortcuts</h2>
              <button
                className="keyboard-shortcuts-close"
                onClick={onClose}
                title="Close (Esc)"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M3 3l8 8M11 3l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {/* Shortcut groups */}
            <div className="keyboard-shortcuts-body">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.title} className="keyboard-shortcuts-group">
                  <h3 className="keyboard-shortcuts-group-title">
                    {group.title}
                  </h3>
                  <div className="keyboard-shortcuts-list">
                    {group.shortcuts.map((shortcut, idx) => (
                      <div key={idx} className="keyboard-shortcuts-row">
                        <span className="keyboard-shortcuts-description">
                          {shortcut.description}
                        </span>
                        <span className="keyboard-shortcuts-keys">
                          {shortcut.keys.map((key, ki) => (
                            <span key={ki} className="keyboard-shortcuts-key-group">
                              {ki > 0 && (
                                <span className="keyboard-shortcuts-separator">+</span>
                              )}
                              <KeyCap label={key} />
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="keyboard-shortcuts-footer">
              <span className="keyboard-shortcuts-footer-hint">
                Press <kbd>Esc</kbd> to close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
