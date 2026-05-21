/**
 * Pure mapping + validation helpers for the Workflow config editor.
 *
 * The desktop does NOT import @tiki/shared at runtime, so the canonical schema
 * validation happens in the Rust `save_tiki_config` command. These helpers
 * provide a minimal client-side mirror so the form can disable Save while
 * obviously invalid and surface inline errors before round-tripping to Rust.
 *
 * Shapes here mirror packages/shared/src/types/config.ts (TikiConfig) — kept
 * deliberately small (only the keys the editor exposes).
 */

export type AutoHealCategory =
  | "build-error"
  | "type-error"
  | "test-failure"
  | "lint-error"
  | "other";

export const AUTO_HEAL_CATEGORIES: AutoHealCategory[] = [
  "build-error",
  "type-error",
  "test-failure",
  "lint-error",
  "other",
];

/** Editable form state — flat for ergonomic two-way binding. */
export interface WorkflowFormState {
  testsEnabled: boolean;
  testsCommand: string; // empty string === null (auto-detect)
  testsRunOnEachPhase: boolean;
  testsRunBeforeShip: boolean;
  testsTimeoutSeconds: number;
  autoHealEnabled: boolean;
  autoHealMaxAttempts: number;
  autoHealCategories: AutoHealCategory[];
  parallelEnabled: boolean;
  backupRetention: number;
}

/** Defaults mirror CONFIG_DEFAULTS in packages/shared/src/types/config.ts. */
export const DEFAULT_WORKFLOW_FORM: WorkflowFormState = {
  testsEnabled: true,
  testsCommand: "",
  testsRunOnEachPhase: false,
  testsRunBeforeShip: true,
  testsTimeoutSeconds: 300,
  autoHealEnabled: false,
  autoHealMaxAttempts: 3,
  autoHealCategories: [
    "build-error",
    "type-error",
    "test-failure",
    "lint-error",
  ],
  parallelEnabled: true,
  backupRetention: 10,
};

/** Raw config shape as returned by `read_tiki_config` (camelCase from Rust). */
export interface RawTikiConfig {
  workflow?: {
    tests?: {
      enabled?: boolean;
      command?: string | null;
      runOnEachPhase?: boolean;
      runBeforeShip?: boolean;
      timeoutSeconds?: number;
    };
    autoHeal?: {
      enabled?: boolean;
      maxAttempts?: number;
      categories?: string[];
    };
    parallel?: {
      enabled?: boolean;
    };
  };
  backupRetention?: number;
  // changelog and any unknown keys are preserved verbatim (see configToForm).
  [key: string]: unknown;
}

export interface ConfigReadResult {
  config: RawTikiConfig;
  warnings: string[];
}

/**
 * Map a raw config (from `read_tiki_config`) into flat form state, applying
 * defaults for any missing key.
 */
export function configToForm(config: RawTikiConfig | null | undefined): WorkflowFormState {
  const tests = config?.workflow?.tests ?? {};
  const autoHeal = config?.workflow?.autoHeal ?? {};
  const parallel = config?.workflow?.parallel ?? {};
  return {
    testsEnabled: tests.enabled ?? DEFAULT_WORKFLOW_FORM.testsEnabled,
    testsCommand: tests.command ?? "",
    testsRunOnEachPhase:
      tests.runOnEachPhase ?? DEFAULT_WORKFLOW_FORM.testsRunOnEachPhase,
    testsRunBeforeShip:
      tests.runBeforeShip ?? DEFAULT_WORKFLOW_FORM.testsRunBeforeShip,
    testsTimeoutSeconds:
      tests.timeoutSeconds ?? DEFAULT_WORKFLOW_FORM.testsTimeoutSeconds,
    autoHealEnabled: autoHeal.enabled ?? DEFAULT_WORKFLOW_FORM.autoHealEnabled,
    autoHealMaxAttempts:
      autoHeal.maxAttempts ?? DEFAULT_WORKFLOW_FORM.autoHealMaxAttempts,
    autoHealCategories: (autoHeal.categories ??
      DEFAULT_WORKFLOW_FORM.autoHealCategories) as AutoHealCategory[],
    parallelEnabled: parallel.enabled ?? DEFAULT_WORKFLOW_FORM.parallelEnabled,
    backupRetention: config?.backupRetention ?? DEFAULT_WORKFLOW_FORM.backupRetention,
  };
}

/**
 * Map flat form state back into the nested config shape for `save_tiki_config`.
 *
 * `existing` carries through any keys the editor does NOT manage (e.g.
 * `changelog`, unknown forward-compat keys) so a save never silently drops
 * them. An empty `testsCommand` serializes to `null` (the auto-detect sentinel).
 */
export function formToConfig(
  form: WorkflowFormState,
  existing?: RawTikiConfig | null
): RawTikiConfig {
  // Shallow-clone existing top-level keys, then overwrite the managed sections.
  const base: RawTikiConfig = { ...(existing ?? {}) };
  const existingWorkflow = (existing?.workflow ?? {}) as Record<string, unknown>;

  base.workflow = {
    ...existingWorkflow,
    tests: {
      enabled: form.testsEnabled,
      command: form.testsCommand.trim() === "" ? null : form.testsCommand.trim(),
      runOnEachPhase: form.testsRunOnEachPhase,
      runBeforeShip: form.testsRunBeforeShip,
      timeoutSeconds: form.testsTimeoutSeconds,
    },
    autoHeal: {
      enabled: form.autoHealEnabled,
      maxAttempts: form.autoHealMaxAttempts,
      categories: form.autoHealCategories,
    },
    parallel: {
      enabled: form.parallelEnabled,
    },
  };
  base.backupRetention = form.backupRetention;
  return base;
}

export type WorkflowFieldErrors = Partial<
  Record<
    "testsTimeoutSeconds" | "autoHealMaxAttempts" | "backupRetention",
    string
  >
>;

/**
 * Client-side validation mirroring the schema's numeric constraints. The Rust
 * command is the source of truth; this just lets the UI disable Save and show
 * inline errors before round-tripping.
 */
export function validateWorkflowForm(form: WorkflowFormState): WorkflowFieldErrors {
  const errors: WorkflowFieldErrors = {};

  if (
    !Number.isInteger(form.testsTimeoutSeconds) ||
    form.testsTimeoutSeconds < 1
  ) {
    errors.testsTimeoutSeconds = "Must be a whole number ≥ 1";
  }
  if (
    !Number.isInteger(form.autoHealMaxAttempts) ||
    form.autoHealMaxAttempts < 1
  ) {
    errors.autoHealMaxAttempts = "Must be a whole number ≥ 1";
  }
  if (!Number.isInteger(form.backupRetention) || form.backupRetention < 0) {
    errors.backupRetention = "Must be a whole number ≥ 0";
  }

  return errors;
}

/** True when the form has no validation errors. */
export function isWorkflowFormValid(form: WorkflowFormState): boolean {
  return Object.keys(validateWorkflowForm(form)).length === 0;
}
