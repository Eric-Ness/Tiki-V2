import { describe, it, expect } from "vitest";
import {
  configToForm,
  formToConfig,
  validateWorkflowForm,
  isWorkflowFormValid,
  DEFAULT_WORKFLOW_FORM,
  type RawTikiConfig,
  type WorkflowFormState,
} from "../workflowConfig";

describe("configToForm", () => {
  it("applies defaults for an empty config", () => {
    expect(configToForm({})).toEqual(DEFAULT_WORKFLOW_FORM);
    expect(configToForm(null)).toEqual(DEFAULT_WORKFLOW_FORM);
    expect(configToForm(undefined)).toEqual(DEFAULT_WORKFLOW_FORM);
  });

  it("maps a full config", () => {
    const raw: RawTikiConfig = {
      workflow: {
        tests: {
          enabled: false,
          command: "npm test",
          runOnEachPhase: true,
          runBeforeShip: false,
          timeoutSeconds: 120,
        },
        autoHeal: {
          enabled: true,
          maxAttempts: 5,
          categories: ["build-error", "lint-error"],
        },
        parallel: { enabled: false },
      },
      backupRetention: 3,
    };
    const form = configToForm(raw);
    expect(form.testsEnabled).toBe(false);
    expect(form.testsCommand).toBe("npm test");
    expect(form.testsRunOnEachPhase).toBe(true);
    expect(form.testsRunBeforeShip).toBe(false);
    expect(form.testsTimeoutSeconds).toBe(120);
    expect(form.autoHealEnabled).toBe(true);
    expect(form.autoHealMaxAttempts).toBe(5);
    expect(form.autoHealCategories).toEqual(["build-error", "lint-error"]);
    expect(form.parallelEnabled).toBe(false);
    expect(form.backupRetention).toBe(3);
  });

  it("treats a null command as an empty string (auto-detect)", () => {
    const form = configToForm({ workflow: { tests: { command: null } } });
    expect(form.testsCommand).toBe("");
  });

  it("applies defaults for a partial config", () => {
    const form = configToForm({ workflow: { tests: { enabled: false } } });
    expect(form.testsEnabled).toBe(false);
    expect(form.testsTimeoutSeconds).toBe(DEFAULT_WORKFLOW_FORM.testsTimeoutSeconds);
    expect(form.autoHealEnabled).toBe(DEFAULT_WORKFLOW_FORM.autoHealEnabled);
  });
});

describe("formToConfig", () => {
  it("serializes an empty command back to null", () => {
    const form: WorkflowFormState = { ...DEFAULT_WORKFLOW_FORM, testsCommand: "  " };
    const config = formToConfig(form);
    expect(config.workflow?.tests?.command).toBeNull();
  });

  it("trims a non-empty command", () => {
    const form: WorkflowFormState = {
      ...DEFAULT_WORKFLOW_FORM,
      testsCommand: "  pnpm test  ",
    };
    const config = formToConfig(form);
    expect(config.workflow?.tests?.command).toBe("pnpm test");
  });

  it("preserves unmanaged top-level keys (changelog, unknowns)", () => {
    const existing: RawTikiConfig = {
      changelog: { template: ".tiki/tpl.md" },
      futureKey: 42,
    };
    const config = formToConfig(DEFAULT_WORKFLOW_FORM, existing);
    expect(config.changelog).toEqual({ template: ".tiki/tpl.md" });
    expect(config.futureKey).toBe(42);
  });

  it("preserves unmanaged keys inside workflow", () => {
    const existing: RawTikiConfig = {
      workflow: { futureWorkflowFlag: true } as Record<string, unknown>,
    };
    const config = formToConfig(DEFAULT_WORKFLOW_FORM, existing);
    expect(
      (config.workflow as Record<string, unknown>).futureWorkflowFlag
    ).toBe(true);
  });

  it("round-trips through configToForm", () => {
    const original: WorkflowFormState = {
      ...DEFAULT_WORKFLOW_FORM,
      testsEnabled: false,
      testsCommand: "cargo test",
      autoHealEnabled: true,
      autoHealMaxAttempts: 2,
      autoHealCategories: ["type-error"],
      parallelEnabled: false,
      backupRetention: 7,
    };
    const roundTripped = configToForm(formToConfig(original));
    expect(roundTripped).toEqual(original);
  });
});

describe("validateWorkflowForm", () => {
  it("accepts valid defaults", () => {
    expect(validateWorkflowForm(DEFAULT_WORKFLOW_FORM)).toEqual({});
    expect(isWorkflowFormValid(DEFAULT_WORKFLOW_FORM)).toBe(true);
  });

  it("rejects a non-positive timeout", () => {
    const errors = validateWorkflowForm({
      ...DEFAULT_WORKFLOW_FORM,
      testsTimeoutSeconds: 0,
    });
    expect(errors.testsTimeoutSeconds).toBeDefined();
    expect(isWorkflowFormValid({ ...DEFAULT_WORKFLOW_FORM, testsTimeoutSeconds: 0 })).toBe(
      false
    );
  });

  it("rejects a non-integer max attempts", () => {
    const errors = validateWorkflowForm({
      ...DEFAULT_WORKFLOW_FORM,
      autoHealMaxAttempts: 2.5,
    });
    expect(errors.autoHealMaxAttempts).toBeDefined();
  });

  it("allows a backup retention of 0 but rejects negatives", () => {
    expect(
      validateWorkflowForm({ ...DEFAULT_WORKFLOW_FORM, backupRetention: 0 })
        .backupRetention
    ).toBeUndefined();
    expect(
      validateWorkflowForm({ ...DEFAULT_WORKFLOW_FORM, backupRetention: -1 })
        .backupRetention
    ).toBeDefined();
  });
});
