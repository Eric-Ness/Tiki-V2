/**
 * Schema Validation Utilities
 * Uses Ajv for JSON Schema validation
 */

import Ajv, { type ValidateFunction, type ErrorObject } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { TikiState } from '../types/state.js';
import type { TikiPlan } from '../types/plan.js';
import type { TikiConfig } from '../types/config.js';

// Import schemas - these will be loaded at runtime
// In Node.js environments, use createRequire or fs to load them
// For bundled environments, they should be inlined

/** Validation result */
export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  errors?: ErrorObject[];
}

/** Create a configured Ajv instance */
export function createAjv(): Ajv {
  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    strictTypes: true,
    strictTuples: true,
  });
  addFormats(ajv);
  return ajv;
}

// Singleton Ajv instance
let ajvInstance: Ajv | null = null;

function getAjv(): Ajv {
  if (!ajvInstance) {
    ajvInstance = createAjv();
  }
  return ajvInstance;
}

// Cached validators
let stateValidator: ValidateFunction<TikiState> | null = null;
let planValidator: ValidateFunction<TikiPlan> | null = null;
let configValidator: ValidateFunction<TikiConfig> | null = null;
let configSchemaCache: ConfigSchema | null = null;

/**
 * Compile and cache a state schema validator
 * Call this once with the schema to set up validation
 */
export function compileStateValidator(
  schema: object
): ValidateFunction<TikiState> {
  const ajv = getAjv();
  stateValidator = ajv.compile<TikiState>(schema);
  return stateValidator;
}

/**
 * Compile and cache a plan schema validator
 * Call this once with the schema to set up validation
 */
export function compilePlanValidator(
  schema: object
): ValidateFunction<TikiPlan> {
  const ajv = getAjv();
  planValidator = ajv.compile<TikiPlan>(schema);
  return planValidator;
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a JSON Schema node we walk for known-key collection and
 * for the relaxed (warning-not-error) Ajv compile.
 */
interface ConfigSchema {
  type?: string | string[];
  properties?: Record<string, ConfigSchema>;
  additionalProperties?: boolean | ConfigSchema;
  $ref?: string;
  $defs?: Record<string, ConfigSchema>;
  [key: string]: unknown;
}

/** Result of validating a `.tiki/config.json` document. */
export interface ConfigValidationResult {
  /** True when there are no type errors (unknown keys do NOT fail). */
  valid: boolean;
  /** Type/format/constraint errors. A non-empty list means `valid` is false. */
  errors: string[];
  /** Dot-paths of unknown keys (warnings only — do not fail validation). */
  unknownKeys: string[];
}

/**
 * Deep-clone a schema while relaxing every `additionalProperties: false` to
 * `true`. Unknown keys must surface as warnings (via a manual walk), not as
 * Ajv errors, so the relaxed validator only reports genuine type/constraint
 * problems.
 */
function relaxAdditionalProperties(node: ConfigSchema): ConfigSchema {
  const clone: ConfigSchema = Array.isArray(node)
    ? (node as unknown as ConfigSchema)
    : { ...node };

  if (clone.additionalProperties === false) {
    clone.additionalProperties = true;
  }

  if (clone.properties) {
    const props: Record<string, ConfigSchema> = {};
    for (const [k, v] of Object.entries(clone.properties)) {
      props[k] = relaxAdditionalProperties(v);
    }
    clone.properties = props;
  }

  if (clone.$defs) {
    const defs: Record<string, ConfigSchema> = {};
    for (const [k, v] of Object.entries(clone.$defs)) {
      defs[k] = relaxAdditionalProperties(v);
    }
    clone.$defs = defs;
  }

  if (
    clone.additionalProperties &&
    typeof clone.additionalProperties === 'object'
  ) {
    clone.additionalProperties = relaxAdditionalProperties(
      clone.additionalProperties
    );
  }

  return clone;
}

/** Resolve a local `#/$defs/...` $ref against the root schema. */
function resolveRef(root: ConfigSchema, ref: string): ConfigSchema | null {
  if (!ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let node: unknown = root;
  for (const part of parts) {
    if (node && typeof node === 'object' && part in (node as object)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return (node as ConfigSchema) ?? null;
}

/**
 * Walk the config object against the schema and collect dot-paths for any key
 * that is not declared in the corresponding object's `properties` (only where
 * `additionalProperties` is `false`). These are reported as warnings.
 */
function collectUnknownKeys(
  root: ConfigSchema,
  schema: ConfigSchema,
  data: unknown,
  path: string,
  out: string[]
): void {
  let node = schema;
  if (node.$ref) {
    const resolved = resolveRef(root, node.$ref);
    if (!resolved) return;
    node = resolved;
  }

  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    !node.properties
  ) {
    return;
  }

  const allowsExtra = node.additionalProperties !== false;
  const props = node.properties;

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    const childSchema = props[key];
    if (!childSchema) {
      if (!allowsExtra) {
        out.push(childPath);
      }
      continue;
    }
    collectUnknownKeys(root, childSchema, value, childPath, out);
  }
}

/**
 * Compile and cache a config schema validator. Stores the raw schema so the
 * unknown-key walk can run against it, and compiles a relaxed copy (unknown
 * keys allowed) so Ajv only reports type/constraint errors.
 */
export function compileConfigValidator(
  schema: object
): ValidateFunction<TikiConfig> {
  // The config schema targets JSON Schema draft 2020-12, which the default
  // (draft-07) Ajv used for state/plan does not understand. Use a dedicated
  // 2020-aware instance so we don't disturb the existing validators.
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictTypes: true,
    strictTuples: true,
  });
  addFormats(ajv);
  configSchemaCache = schema as ConfigSchema;
  const relaxed = relaxAdditionalProperties(schema as ConfigSchema);
  configValidator = ajv.compile<TikiConfig>(relaxed);
  return configValidator;
}

/**
 * Validate a `.tiki/config.json` document.
 *
 * Type/format/constraint mismatches are errors (fail validation). Unknown keys
 * are warnings (surfaced in `unknownKeys`) and do NOT fail validation, so a
 * config authored against a newer schema still loads on an older binary.
 */
export function validateConfig(data: unknown): ConfigValidationResult {
  if (!configValidator || !configSchemaCache) {
    throw new Error(
      'Config validator not initialized. Call compileConfigValidator first.'
    );
  }

  const errors: string[] = [];
  const valid = configValidator(data);
  if (!valid && configValidator.errors) {
    for (const err of configValidator.errors) {
      const where = err.instancePath || '/';
      errors.push(`${where}: ${err.message ?? 'invalid'}`);
    }
  }

  const unknownKeys: string[] = [];
  collectUnknownKeys(configSchemaCache, configSchemaCache, data, '', unknownKeys);

  return { valid: errors.length === 0, errors, unknownKeys };
}

/**
 * Validate a state object
 * Returns the validated data if valid, or errors if not
 */
export function validateState(data: unknown): ValidationResult<TikiState> {
  if (!stateValidator) {
    throw new Error(
      'State validator not initialized. Call compileStateValidator first.'
    );
  }

  const valid = stateValidator(data);
  if (valid) {
    return { valid: true, data: data as TikiState };
  }
  return { valid: false, errors: stateValidator.errors ?? [] };
}

/**
 * Validate a plan object
 * Returns the validated data if valid, or errors if not
 */
export function validatePlan(data: unknown): ValidationResult<TikiPlan> {
  if (!planValidator) {
    throw new Error(
      'Plan validator not initialized. Call compilePlanValidator first.'
    );
  }

  const valid = planValidator(data);
  if (valid) {
    return { valid: true, data: data as TikiPlan };
  }
  return { valid: false, errors: planValidator.errors ?? [] };
}

/**
 * Format validation errors into a human-readable string
 */
export function formatValidationErrors(errors: ErrorObject[]): string {
  return errors
    .map((err) => {
      const path = err.instancePath || '/';
      const message = err.message || 'unknown error';
      return `  ${path}: ${message}`;
    })
    .join('\n');
}

/**
 * Assert that data is a valid state, throwing if not
 */
export function assertValidState(data: unknown): asserts data is TikiState {
  const result = validateState(data);
  if (!result.valid) {
    throw new Error(
      `Invalid state:\n${formatValidationErrors(result.errors ?? [])}`
    );
  }
}

/**
 * Assert that data is a valid plan, throwing if not
 */
export function assertValidPlan(data: unknown): asserts data is TikiPlan {
  const result = validatePlan(data);
  if (!result.valid) {
    throw new Error(
      `Invalid plan:\n${formatValidationErrors(result.errors ?? [])}`
    );
  }
}
