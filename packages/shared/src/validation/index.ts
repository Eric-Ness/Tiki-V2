/**
 * Schema Validation Utilities
 * Uses Ajv for JSON Schema validation
 */

import Ajv, { type ValidateFunction, type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import type { TikiState } from '../types/state.js';
import type { TikiPlan } from '../types/plan.js';

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
