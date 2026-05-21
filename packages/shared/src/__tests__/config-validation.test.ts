/**
 * Tests for `validateConfig` against `schemas/config.schema.json`.
 *
 * Contract:
 *   - Type/format/constraint mismatches are ERRORS (fail validation).
 *   - Unknown keys are WARNINGS (surfaced in `unknownKeys`) and do NOT fail.
 *   - Partial configs and the empty object are valid (all keys optional).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileConfigValidator, validateConfig } from '../validation/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const schemaPath = resolve(
  __dirname,
  '..',
  '..',
  'schemas',
  'config.schema.json'
);

beforeAll(() => {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  compileConfigValidator(schema);
});

describe('validateConfig', () => {
  it('accepts a valid full config', () => {
    const config = {
      workflow: {
        tests: {
          enabled: true,
          command: null,
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
          ],
        },
        parallel: {
          enabled: true,
        },
      },
      changelog: {
        template: '.tiki/changelog-template.md',
        categories: {
          feat: 'New Features',
          fix: 'Bug Fixes',
        },
        includeCommitHashes: false,
        includeAuthors: false,
      },
      backupRetention: 10,
    };

    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.unknownKeys).toEqual([]);
  });

  it('treats an unknown key as a warning, not a failure', () => {
    const config = {
      workflow: {
        tests: { enabled: true },
        bogusKey: { foo: 'bar' },
      },
      anotherUnknown: 123,
    };

    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.unknownKeys).toContain('workflow.bogusKey');
    expect(result.unknownKeys).toContain('anotherUnknown');
  });

  it('reports a type mismatch as an error', () => {
    const config = {
      workflow: {
        tests: {
          // wrong type: should be boolean
          enabled: 'yes',
          // wrong type: should be integer
          timeoutSeconds: 'soon',
        },
      },
    };

    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('reports an invalid enum value as an error', () => {
    const config = {
      workflow: {
        autoHeal: {
          categories: ['build-error', 'not-a-real-category'],
        },
      },
    };

    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('accepts a partial config', () => {
    const config = {
      workflow: {
        tests: { enabled: false },
      },
    };

    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.unknownKeys).toEqual([]);
  });

  it('accepts an empty object', () => {
    const result = validateConfig({});
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.unknownKeys).toEqual([]);
  });

  it('accepts a null command (auto-detect sentinel)', () => {
    const result = validateConfig({
      workflow: { tests: { command: null } },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects backupRetention of the wrong type', () => {
    const result = validateConfig({ backupRetention: 'ten' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
