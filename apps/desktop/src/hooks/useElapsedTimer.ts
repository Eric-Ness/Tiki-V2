import { useState, useEffect } from "react";
import { formatDuration, getElapsedSince } from "../utils/duration";

/**
 * Hook that returns a live-updating formatted duration string
 * showing time elapsed since `startedAt`. Updates every second.
 * Returns null if startedAt is null/undefined.
 */
export function useElapsedTimer(startedAt: string | null | undefined): string | null {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    if (!startedAt) {
      setFormatted(null);
      return;
    }

    // Initial value
    setFormatted(formatDuration(getElapsedSince(startedAt)));

    const interval = setInterval(() => {
      setFormatted(formatDuration(getElapsedSince(startedAt)));
    }, 1000);

    return () => clearInterval(interval);
  }, [startedAt]);

  return formatted;
}
