// Bulk-YOLO cascade hook (#234). Returns a stable callback that advances the
// cascade on a state change, backed by the pure (unit-tested)
// advanceBulkYoloOnStateChange. Wiring it through a hook keeps App.tsx's
// concerns symmetric (one hook per extracted concern) while the logic stays
// testable without React.

import { useCallback } from "react";
import { advanceBulkYoloOnStateChange } from "../utils/bulkYoloCascade";
import type { TikiState } from "../utils/tikiStateSync";

export function useBulkYoloCascade(): (prev: TikiState, next: TikiState) => void {
  return useCallback((prev: TikiState, next: TikiState) => {
    advanceBulkYoloOnStateChange(prev, next);
  }, []);
}
