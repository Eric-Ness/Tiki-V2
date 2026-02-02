/**
 * @tiki/shared
 * Shared schemas and types for Tiki v2
 */

// Re-export all types
export * from './types/index.js';

// Re-export validation utilities
export * from './validation/index.js';

// Schema paths (relative to package root)
export const SCHEMA_PATHS = {
  state: 'schemas/state.schema.json',
  plan: 'schemas/plan.schema.json',
} as const;

// Tiki file paths (relative to project root)
export const TIKI_PATHS = {
  root: '.tiki',
  state: '.tiki/state.json',
  config: '.tiki/config.json',
  plans: '.tiki/plans',
  releases: '.tiki/releases',
  research: '.tiki/research',
  knowledge: '.tiki/knowledge',
  commands: '.tiki/commands',
  hooks: '.tiki/hooks',
} as const;
