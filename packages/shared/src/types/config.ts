/**
 * Tiki Config Types
 * Matches: schemas/config.schema.json
 *
 * Project-level configuration read from `.tiki/config.json` by framework
 * commands (execute, ship, release) and the desktop Rust backend (fs_utils
 * backup retention). All fields are optional — missing keys fall back to the
 * defaults documented inline.
 */

/** Error categories eligible for auto-heal */
export type AutoHealCategory =
  | 'build-error'
  | 'type-error'
  | 'test-failure'
  | 'lint-error'
  | 'other';

/** Test-running behavior during EXECUTE and SHIP */
export interface TestsConfig {
  /** Whether tests run at all (default true) */
  enabled?: boolean;
  /**
   * Explicit test command override. If null, the framework auto-detects
   * (vitest, jest, pytest, cargo test, go test).
   */
  command?: string | null;
  /** Run tests after every phase, not just the final one (default false) */
  runOnEachPhase?: boolean;
  /** Run the full test suite before shipping (default true) */
  runBeforeShip?: boolean;
  /** Timeout in seconds for a test run (default 300) */
  timeoutSeconds?: number;
}

/** Opt-in auto-heal loop for failed phase verification */
export interface AutoHealConfig {
  /** Whether auto-heal is enabled (default false) */
  enabled?: boolean;
  /** Maximum heal attempts per phase (default 3) */
  maxAttempts?: number;
  /** Error categories eligible for auto-heal */
  categories?: AutoHealCategory[];
}

/** Parallel phase execution (EXECUTE) */
export interface ParallelConfig {
  /** Whether independent phases may run in parallel (default true) */
  enabled?: boolean;
}

/** Workflow behavior for the GET -> SHIP pipeline */
export interface WorkflowConfig {
  /** Test-running behavior */
  tests?: TestsConfig;
  /** Auto-heal loop configuration */
  autoHeal?: AutoHealConfig;
  /** Parallel execution configuration */
  parallel?: ParallelConfig;
}

/** Changelog generation customization (RELEASE) */
export interface ChangelogConfig {
  /** Path to a custom changelog template with placeholders */
  template?: string;
  /** Maps commit prefixes to display category names */
  categories?: Record<string, string>;
  /** Include commit hashes in changelog entries (default false) */
  includeCommitHashes?: boolean;
  /** Include commit authors in changelog entries (default false) */
  includeAuthors?: boolean;
}

/** Project-level Tiki configuration (`.tiki/config.json`) */
export interface TikiConfig {
  /** Workflow behavior for the pipeline */
  workflow?: WorkflowConfig;
  /** Changelog generation customization */
  changelog?: ChangelogConfig;
  /** Number of timestamped state.json backups to keep (default 10) */
  backupRetention?: number;
}

/** Default config values applied when a key is missing */
export const CONFIG_DEFAULTS = {
  workflow: {
    tests: {
      enabled: true,
      command: null as string | null,
      runOnEachPhase: false,
      runBeforeShip: true,
      timeoutSeconds: 300,
    },
    autoHeal: {
      enabled: false,
      maxAttempts: 3,
      categories: [
        'build-error',
        'type-error',
        'test-failure',
        'lint-error',
      ] as AutoHealCategory[],
    },
    parallel: {
      enabled: true,
    },
  },
  backupRetention: 10,
} as const;
