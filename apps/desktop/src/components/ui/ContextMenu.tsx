import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './ContextMenu.css';

// --- Types ---

export interface ContextMenuItem {
  /** Unique key for the item */
  key: string;
  /** Display label */
  label: string;
  /** Optional icon (ReactNode, e.g. an SVG) */
  icon?: ReactNode;
  /** Click handler */
  onClick: () => void;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Optional keyboard shortcut hint displayed on the right */
  shortcut?: string;
  /** When true, renders in a red/danger style */
  danger?: boolean;
}

export interface ContextMenuSeparator {
  key: string;
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return 'separator' in entry && entry.separator === true;
}

// --- Position state ---

export interface ContextMenuPosition {
  x: number;
  y: number;
}

// --- Hook ---

export interface UseContextMenuResult {
  /** Whether the context menu is currently visible */
  isOpen: boolean;
  /** The position to render the menu at */
  position: ContextMenuPosition;
  /** Call this from onContextMenu to show the menu */
  handleContextMenu: (e: React.MouseEvent) => void;
  /** Call this from onKeyDown (Shift+F10) to show the menu */
  handleKeyDown: (e: React.KeyboardEvent) => void;
  /** Close the menu */
  close: () => void;
}

export function useContextMenu(): UseContextMenuResult {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<ContextMenuPosition>({ x: 0, y: 0 });

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPosition({ x: e.clientX, y: e.clientY });
    setIsOpen(true);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Shift+F10 or the context menu key (ContextMenu)
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault();
      e.stopPropagation();
      // Position near the element that triggered it
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      setIsOpen(true);
    }
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return { isOpen, position, handleContextMenu, handleKeyDown, close };
}

// --- Component ---

export interface ContextMenuProps {
  /** Whether to render the menu */
  isOpen: boolean;
  /** Screen coordinates for the menu */
  position: ContextMenuPosition;
  /** Menu entries (items + separators) */
  items: ContextMenuEntry[];
  /** Called when the menu should close */
  onClose: () => void;
}

export function ContextMenu({ isOpen, position, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  // Filter to get only actionable items for keyboard navigation
  const actionableItems = items.filter((item): item is ContextMenuItem => !isSeparator(item));

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (!isOpen) return;

    // Reset focus when opening
    setFocusIndex(-1);

    // Use requestAnimationFrame to measure after render
    requestAnimationFrame(() => {
      if (!menuRef.current) return;
      const rect = menuRef.current.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;

      let x = position.x;
      let y = position.y;

      // Flip horizontally if overflowing right
      if (x + rect.width > viewportW - 8) {
        x = Math.max(8, viewportW - rect.width - 8);
      }

      // Flip vertically if overflowing bottom
      if (y + rect.height > viewportH - 8) {
        y = Math.max(8, viewportH - rect.height - 8);
      }

      setAdjustedPosition({ x, y });
    });
  }, [isOpen, position]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowDown': {
          e.preventDefault();
          setFocusIndex((prev) => {
            // Find next non-disabled item
            let next = prev;
            for (let i = 0; i < actionableItems.length; i++) {
              next = (next + 1) % actionableItems.length;
              if (!actionableItems[next].disabled) return next;
            }
            return prev;
          });
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setFocusIndex((prev) => {
            let next = prev;
            for (let i = 0; i < actionableItems.length; i++) {
              next = (next - 1 + actionableItems.length) % actionableItems.length;
              if (!actionableItems[next].disabled) return next;
            }
            return prev;
          });
          break;
        }
        case 'Enter':
        case ' ': {
          e.preventDefault();
          if (focusIndex >= 0 && focusIndex < actionableItems.length) {
            const item = actionableItems[focusIndex];
            if (!item.disabled) {
              onClose();
              item.onClick();
            }
          }
          break;
        }
        case 'Home': {
          e.preventDefault();
          // Focus first non-disabled item
          const firstEnabled = actionableItems.findIndex((item) => !item.disabled);
          if (firstEnabled >= 0) setFocusIndex(firstEnabled);
          break;
        }
        case 'End': {
          e.preventDefault();
          // Focus last non-disabled item
          for (let i = actionableItems.length - 1; i >= 0; i--) {
            if (!actionableItems[i].disabled) {
              setFocusIndex(i);
              break;
            }
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, focusIndex, actionableItems, onClose]);

  // Close on scroll anywhere
  useEffect(() => {
    if (!isOpen) return;

    const handleScroll = () => onClose();
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Track which actionable item index we are at when rendering
  let actionableIndex = -1;

  const menu = (
    <>
      <div className="context-menu-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={menuRef}
        className="context-menu"
        role="menu"
        style={{
          left: adjustedPosition.x,
          top: adjustedPosition.y,
        }}
      >
        {items.map((entry) => {
          if (isSeparator(entry)) {
            return <div key={entry.key} className="context-menu-separator" role="separator" />;
          }

          actionableIndex++;
          const currentIndex = actionableIndex;
          const isFocused = focusIndex === currentIndex;
          const classNames = [
            'context-menu-item',
            isFocused && 'focused',
            entry.disabled && 'disabled',
            entry.danger && 'danger',
          ].filter(Boolean).join(' ');

          return (
            <button
              key={entry.key}
              className={classNames}
              role="menuitem"
              disabled={entry.disabled}
              onClick={() => {
                if (!entry.disabled) {
                  onClose();
                  entry.onClick();
                }
              }}
              onMouseEnter={() => setFocusIndex(currentIndex)}
            >
              {entry.icon && <span className="context-menu-item-icon">{entry.icon}</span>}
              <span className="context-menu-item-label">{entry.label}</span>
              {entry.shortcut && <span className="context-menu-item-shortcut">{entry.shortcut}</span>}
            </button>
          );
        })}
      </div>
    </>
  );

  return createPortal(menu, document.body);
}
