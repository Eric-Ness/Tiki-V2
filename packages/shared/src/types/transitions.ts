/**
 * Canonical WorkStatus transition table for Tiki v2.
 *
 * This module is the single source of truth for legal state machine
 * transitions. The Rust implementation in
 * `apps/desktop/src-tauri/src/state_transition.rs` and the JS shim in
 * `packages/framework/scripts/state.mjs` mirror this table and must be
 * kept in sync with it.
 */

import type { WorkStatus } from './state.js';

export const VALID_TRANSITIONS: Readonly<Record<WorkStatus, ReadonlySet<WorkStatus>>> = {
  pending: new Set<WorkStatus>(['reviewing', 'planning', 'executing', 'paused', 'failed']),
  reviewing: new Set<WorkStatus>(['planning', 'executing', 'paused', 'failed']),
  planning: new Set<WorkStatus>(['executing', 'paused', 'failed']),
  executing: new Set<WorkStatus>(['shipping', 'paused', 'failed', 'completed']),
  shipping: new Set<WorkStatus>(['completed', 'failed']),
  paused: new Set<WorkStatus>(['pending', 'reviewing', 'planning', 'executing', 'shipping']),
  failed: new Set<WorkStatus>(['pending', 'reviewing', 'planning', 'executing']),
  completed: new Set<WorkStatus>(),
};

/**
 * Returns true if a transition from `from` to `to` is legal per the
 * canonical table. Same-status transitions are always legal (idempotent).
 */
export function canTransition(from: WorkStatus, to: WorkStatus): boolean {
  if (from === to) return true;
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.has(to) : false;
}

/**
 * Throws an Error if a transition from `from` to `to` is illegal per
 * the canonical table. Silent on legal pairs and same-status.
 */
export function assertTransition(from: WorkStatus, to: WorkStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal transition: ${from} → ${to}`);
  }
}
