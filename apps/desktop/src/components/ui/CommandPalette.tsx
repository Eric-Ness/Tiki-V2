import { useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useCommandPaletteStore,
  filterAndSortActions,
  type CommandAction,
  type CommandCategory,
} from "../../stores";
import "./CommandPalette.css";

// --- Category icons (SVG) ---

const categoryIcons: Record<CommandCategory, React.ReactNode> = {
  navigation: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 8h10M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  project: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M2 4.5A1.5 1.5 0 013.5 3h2.379a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  issue: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  ),
  release: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 2v4l2.5 1.5M14 8A6 6 0 112 8a6 6 0 0112 0z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  command: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M4 5.5l3.5 2.5L4 10.5M9 10.5h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  ),
};

// --- Search icon ---

const SearchIcon = (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M11.5 11.5L16 16"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

// --- Shortcut rendering helper ---

function renderShortcut(shortcut: string) {
  const parts = shortcut.split("+").map((s) => s.trim());
  return (
    <span className="command-palette-item-shortcut">
      {parts.map((part, i) => (
        <kbd key={i}>{part}</kbd>
      ))}
    </span>
  );
}

// --- Component ---

interface CommandPaletteProps {
  actions: CommandAction[];
}

export function CommandPalette({ actions }: CommandPaletteProps) {
  const {
    isOpen,
    query,
    selectedIndex,
    recentCommandIds,
    close,
    setQuery,
    setSelectedIndex,
    addRecentCommand,
  } = useCommandPaletteStore();

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Filtered and sorted results
  const filteredActions = useMemo(
    () => filterAndSortActions(actions, query, recentCommandIds),
    [actions, query, recentCommandIds]
  );

  // Determine which actions are "recent" for section header display
  const recentSet = useMemo(() => new Set(recentCommandIds), [recentCommandIds]);

  // Build sections: when query is empty, show "Recent" and "All Commands" headers
  const sections = useMemo(() => {
    if (query.length > 0) {
      return [{ label: null, items: filteredActions }];
    }

    const recents: CommandAction[] = [];
    const rest: CommandAction[] = [];

    for (const action of filteredActions) {
      if (recentSet.has(action.id)) {
        recents.push(action);
      } else {
        rest.push(action);
      }
    }

    const result: Array<{ label: string | null; items: CommandAction[] }> = [];
    if (recents.length > 0) {
      result.push({ label: "Recent", items: recents });
    }
    if (rest.length > 0) {
      result.push({ label: "All Commands", items: rest });
    }
    return result;
  }, [query, filteredActions, recentSet]);

  // Flatten sections to get a flat index for keyboard navigation
  const flatItems = useMemo(
    () => sections.flatMap((s) => s.items),
    [sections]
  );

  // Clamp selectedIndex if filtered list shrinks
  useEffect(() => {
    if (selectedIndex >= flatItems.length && flatItems.length > 0) {
      setSelectedIndex(0);
    }
  }, [flatItems.length, selectedIndex, setSelectedIndex]);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure the DOM has rendered
      const timer = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Execute the selected action
  const executeAction = useCallback(
    (action: CommandAction) => {
      addRecentCommand(action.id);
      close();
      action.execute();
    },
    [addRecentCommand, close]
  );

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          if (flatItems.length === 0) return;
          setSelectedIndex(
            selectedIndex >= flatItems.length - 1 ? 0 : selectedIndex + 1
          );
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          if (flatItems.length === 0) return;
          setSelectedIndex(
            selectedIndex <= 0 ? flatItems.length - 1 : selectedIndex - 1
          );
          break;
        }
        case "Enter": {
          e.preventDefault();
          const action = flatItems[selectedIndex];
          if (action) {
            executeAction(action);
          }
          break;
        }
        case "Escape": {
          e.preventDefault();
          close();
          break;
        }
      }
    },
    [flatItems, selectedIndex, setSelectedIndex, executeAction, close]
  );

  // Click on backdrop
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        close();
      }
    },
    [close]
  );

  // Register item ref for scroll-into-view
  const setItemRef = useCallback(
    (flatIndex: number, el: HTMLDivElement | null) => {
      if (el) {
        itemRefs.current.set(flatIndex, el);
      } else {
        itemRefs.current.delete(flatIndex);
      }
    },
    []
  );

  // Build the renderable list with section headers interspersed
  let flatIndex = 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="command-palette-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={handleOverlayClick}
          onKeyDown={handleKeyDown}
        >
          <motion.div
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {/* Search input */}
            <div className="command-palette-search">
              <span className="command-palette-search-icon">{SearchIcon}</span>
              <input
                ref={inputRef}
                className="command-palette-search-input"
                type="text"
                placeholder="Type a command..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {/* Results */}
            <div className="command-palette-results" ref={listRef}>
              {flatItems.length === 0 ? (
                <div className="command-palette-empty">
                  No matching commands
                </div>
              ) : (
                sections.map((section, sIdx) => {
                  const sectionElements: React.ReactNode[] = [];

                  if (section.label) {
                    sectionElements.push(
                      <div
                        key={`header-${sIdx}`}
                        className="command-palette-section-header"
                      >
                        {section.label}
                      </div>
                    );
                  }

                  for (const action of section.items) {
                    const idx = flatIndex;
                    const isSelected = idx === selectedIndex;
                    sectionElements.push(
                      <div
                        key={action.id}
                        ref={(el) => setItemRef(idx, el)}
                        className={`command-palette-item${isSelected ? " selected" : ""}`}
                        onClick={() => executeAction(action)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <div className="command-palette-item-icon">
                          {categoryIcons[action.category]}
                        </div>
                        <div className="command-palette-item-content">
                          <span className="command-palette-item-title">
                            {action.title}
                          </span>
                          {action.subtitle && (
                            <span className="command-palette-item-subtitle">
                              {action.subtitle}
                            </span>
                          )}
                        </div>
                        {action.shortcut && renderShortcut(action.shortcut)}
                      </div>
                    );
                    flatIndex++;
                  }

                  return sectionElements;
                })
              )}
            </div>

            {/* Footer hints */}
            <div className="command-palette-footer">
              <span className="command-palette-footer-hint">
                <kbd>&uarr;</kbd>
                <kbd>&darr;</kbd>
                navigate
              </span>
              <span className="command-palette-footer-hint">
                <kbd>&crarr;</kbd>
                select
              </span>
              <span className="command-palette-footer-hint">
                <kbd>esc</kbd>
                close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
