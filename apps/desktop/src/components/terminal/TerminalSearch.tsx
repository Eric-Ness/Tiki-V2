import { useEffect, useRef, useState } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import "./TerminalSearch.css";

// SearchAddon.findNext returns only a boolean (found/not found). It does NOT
// expose a total match count via its public API, so the indicator below shows
// "Match found" / "No results" rather than "N of M".
export function formatMatchCount(found: boolean, query: string): string {
  if (!query.trim()) return "";
  return found ? "Match found" : "No results";
}

export function isNoMatch(found: boolean, query: string): boolean {
  return query.trim().length > 0 && !found;
}

// Exported for unit testing. A regex search term that won't compile must not
// throw out of the debounced effect — callers pre-validate with this.
export function isValidRegex(query: string): boolean {
  if (!query) return true; // empty query is a no-op search, not an error
  try {
    new RegExp(query);
    return true;
  } catch {
    return false;
  }
}

interface TerminalSearchProps {
  searchAddon: SearchAddon;
  onClose: () => void;
  onQueryChange: (q: string) => void;
}

const DEBOUNCE_MS = 150;

export function TerminalSearch({ searchAddon, onClose, onQueryChange }: TerminalSearchProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [found, setFound] = useState(true);
  const [regexError, setRegexError] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus the input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search-as-you-type
  useEffect(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      onQueryChange(query);
      if (query === "") {
        // Clear highlights by searching for empty
        searchAddon.findNext("", {});
        setFound(true);
        setRegexError(false);
        return;
      }
      if (useRegex && !isValidRegex(query)) {
        // Don't hand an uncompilable pattern to the addon — flag it instead.
        setRegexError(true);
        setFound(false);
        return;
      }
      setRegexError(false);
      const result = searchAddon.findNext(query, {
        caseSensitive,
        regex: useRegex,
        incremental: false,
      });
      setFound(result);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, caseSensitive, useRegex, searchAddon, onQueryChange]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        searchAddon.findPrevious(query, { caseSensitive, regex: useRegex });
      } else {
        searchAddon.findNext(query, { caseSensitive, regex: useRegex });
      }
    }
  };

  const inputClass = `terminal-search-input${
    isNoMatch(found, query) || regexError ? " terminal-search-input--no-match" : ""
  }`;

  return (
    <div className="terminal-search">
      <input
        ref={inputRef}
        className={inputClass}
        type="text"
        placeholder="Find in terminal..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleInputKeyDown}
        aria-label="Search terminal buffer"
      />
      <span className="terminal-search-count">
        {regexError ? "Invalid regex" : formatMatchCount(found, query)}
      </span>
      <button
        type="button"
        className={`terminal-search-btn${useRegex ? " terminal-search-btn--active" : ""}`}
        onClick={() => setUseRegex((v) => !v)}
        title={useRegex ? "Regex (on)" : "Regex (off)"}
        aria-pressed={useRegex}
      >
        .*
      </button>
      <button
        type="button"
        className={`terminal-search-btn${caseSensitive ? " terminal-search-btn--active" : ""}`}
        onClick={() => setCaseSensitive((v) => !v)}
        title={caseSensitive ? "Case-sensitive (on)" : "Case-sensitive (off)"}
        aria-pressed={caseSensitive}
      >
        Aa
      </button>
      <button
        type="button"
        className="terminal-search-btn"
        onClick={() => searchAddon.findPrevious(query, { caseSensitive, regex: useRegex })}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        ▲
      </button>
      <button
        type="button"
        className="terminal-search-btn"
        onClick={() => searchAddon.findNext(query, { caseSensitive, regex: useRegex })}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        ▼
      </button>
      <button
        type="button"
        className="terminal-search-btn"
        onClick={onClose}
        title="Close (Escape)"
        aria-label="Close search"
      >
        ✕
      </button>
    </div>
  );
}
