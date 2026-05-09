import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useProjectsStore } from "../../stores";
import "./PlanEditor.css";

export interface EditorSuccessCriterion {
  id: string;
  category: string;
  description: string;
}

export interface EditorPhase {
  number: number;
  title: string;
  status: string;
  content: string;
  verification: string[];
  files: string[];
  addressesCriteria: string[];
  dependencies: number[];
  startedAt?: string | null;
  completedAt?: string | null;
  summary?: string | null;
}

export interface EditorPlan {
  schemaVersion: number;
  issue: { number: number; title?: string; url?: string };
  createdAt: string;
  successCriteria: EditorSuccessCriterion[];
  phases: EditorPhase[];
  coverageMatrix: Record<string, number[]>;
}

interface PlanEditorProps {
  plan: EditorPlan;
  issueNumber: number;
  onClose: () => void;
}

interface SortablePhaseCardProps {
  phase: EditorPhase;
  idx: number;
  successCriteria: EditorSuccessCriterion[];
  errorsByField: Record<string, string>;
  confirmRemovePhase: number | null;
  setConfirmRemovePhase: (n: number | null) => void;
  onUpdatePhaseField: <K extends keyof EditorPhase>(
    idx: number,
    field: K,
    value: EditorPhase[K],
  ) => void;
  onRemovePhase: (phaseNumber: number) => void;
  onUpdateStringArrayItem: (
    phaseIdx: number,
    field: "verification" | "files",
    itemIdx: number,
    value: string,
  ) => void;
  onAddStringArrayItem: (
    phaseIdx: number,
    field: "verification" | "files",
  ) => void;
  onRemoveStringArrayItem: (
    phaseIdx: number,
    field: "verification" | "files",
    itemIdx: number,
  ) => void;
  onUpdateDependency: (
    phaseIdx: number,
    itemIdx: number,
    rawValue: string,
  ) => void;
  onAddDependency: (phaseIdx: number) => void;
  onRemoveDependency: (phaseIdx: number, itemIdx: number) => void;
  onToggleAddressesCriteria: (phaseIdx: number, scId: string) => void;
}

function SortablePhaseCard({
  phase,
  idx,
  successCriteria,
  errorsByField,
  confirmRemovePhase,
  setConfirmRemovePhase,
  onUpdatePhaseField,
  onRemovePhase,
  onUpdateStringArrayItem,
  onAddStringArrayItem,
  onRemoveStringArrayItem,
  onUpdateDependency,
  onAddDependency,
  onRemoveDependency,
  onToggleAddressesCriteria,
}: SortablePhaseCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: phase.number });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const titleError = errorsByField[`phase-${phase.number}-title`];
  const numberError = errorsByField[`phase-${phase.number}-number`];
  const depsError = errorsByField[`phase-${phase.number}-deps`];
  const criteriaError = errorsByField[`phase-${phase.number}-criteria`];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="plan-editor-phase-card"
    >
      <div className="plan-editor-phase-header">
        <div
          className="plan-editor-phase-drag-handle"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder phase"
          title="Drag to reorder"
        >
          &#8942;&#8942;
        </div>
        <span className="plan-editor-phase-number">#{phase.number}</span>
        <span className="plan-editor-status-badge">{phase.status}</span>
        <div style={{ flex: 1 }} />
        {confirmRemovePhase === phase.number ? (
          <div className="plan-editor-confirm-remove">
            <span style={{ fontSize: 12 }}>Remove this phase?</span>
            <button
              type="button"
              className="plan-editor-remove-btn"
              onClick={() => onRemovePhase(phase.number)}
            >
              Confirm
            </button>
            <button
              type="button"
              className="plan-editor-close-btn"
              onClick={() => setConfirmRemovePhase(null)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="plan-editor-remove-btn"
            onClick={() => setConfirmRemovePhase(phase.number)}
          >
            Remove
          </button>
        )}
      </div>

      {/* Title */}
      <div>
        <div className="plan-editor-field-label">Title</div>
        <input
          type="text"
          className="plan-editor-input"
          value={phase.title}
          onChange={(e) =>
            onUpdatePhaseField(idx, "title", e.target.value)
          }
          placeholder="Phase title"
        />
        {titleError && (
          <span className="plan-editor-field-error">{titleError}</span>
        )}
        {numberError && (
          <span className="plan-editor-field-error">{numberError}</span>
        )}
      </div>

      {/* Content */}
      <div>
        <div className="plan-editor-field-label">Content</div>
        <textarea
          className="plan-editor-textarea"
          rows={6}
          value={phase.content}
          onChange={(e) =>
            onUpdatePhaseField(idx, "content", e.target.value)
          }
          placeholder="Phase content (markdown)"
        />
      </div>

      {/* Verification */}
      <div>
        <div className="plan-editor-field-label">Verification</div>
        {phase.verification.map((v, vIdx) => (
          <div key={vIdx} className="plan-editor-array-row">
            <input
              type="text"
              className="plan-editor-input"
              value={v}
              onChange={(e) =>
                onUpdateStringArrayItem(
                  idx,
                  "verification",
                  vIdx,
                  e.target.value,
                )
              }
              placeholder="verification step"
            />
            <button
              type="button"
              className="plan-editor-remove-btn"
              onClick={() =>
                onRemoveStringArrayItem(idx, "verification", vIdx)
              }
              aria-label="Remove verification"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="plan-editor-add-btn"
          onClick={() => onAddStringArrayItem(idx, "verification")}
        >
          + Add verification
        </button>
      </div>

      {/* Files */}
      <div>
        <div className="plan-editor-field-label">Files</div>
        {phase.files.map((f, fIdx) => (
          <div key={fIdx} className="plan-editor-array-row">
            <input
              type="text"
              className="plan-editor-input"
              value={f}
              onChange={(e) =>
                onUpdateStringArrayItem(idx, "files", fIdx, e.target.value)
              }
              placeholder="path/to/file"
            />
            <button
              type="button"
              className="plan-editor-remove-btn"
              onClick={() => onRemoveStringArrayItem(idx, "files", fIdx)}
              aria-label="Remove file"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="plan-editor-add-btn"
          onClick={() => onAddStringArrayItem(idx, "files")}
        >
          + Add file
        </button>
      </div>

      {/* addressesCriteria checkboxes */}
      <div>
        <div className="plan-editor-field-label">Addresses Criteria</div>
        {successCriteria.length === 0 ? (
          <p style={{ fontSize: 12, opacity: 0.7, margin: 0 }}>
            No success criteria available.
          </p>
        ) : (
          successCriteria.map((sc) => {
            const checked = phase.addressesCriteria.includes(sc.id);
            return (
              <label
                key={sc.id}
                className="plan-editor-criteria-checkbox-row"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleAddressesCriteria(idx, sc.id)}
                />
                <span>
                  {sc.id}
                  {sc.description ? `: ${sc.description}` : ""}
                </span>
              </label>
            );
          })
        )}
        {criteriaError && (
          <span className="plan-editor-field-error">{criteriaError}</span>
        )}
      </div>

      {/* Dependencies */}
      <div>
        <div className="plan-editor-field-label">Dependencies</div>
        {phase.dependencies.map((dep, dIdx) => (
          <div key={dIdx} className="plan-editor-array-row">
            <input
              type="number"
              className="plan-editor-input"
              value={dep}
              onChange={(e) =>
                onUpdateDependency(idx, dIdx, e.target.value)
              }
              placeholder="phase number"
            />
            <button
              type="button"
              className="plan-editor-remove-btn"
              onClick={() => onRemoveDependency(idx, dIdx)}
              aria-label="Remove dependency"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="plan-editor-add-btn"
          onClick={() => onAddDependency(idx)}
        >
          + Add dependency
        </button>
        {depsError && (
          <span className="plan-editor-field-error">{depsError}</span>
        )}
      </div>
    </div>
  );
}

// ---------- Phase 5: derivation helpers ----------

function recomputeCoverageMatrix(
  phases: EditorPhase[],
  criteria: EditorSuccessCriterion[],
): Record<string, number[]> {
  const matrix: Record<string, number[]> = {};
  for (const sc of criteria) matrix[sc.id] = [];
  for (const phase of phases) {
    for (const scId of phase.addressesCriteria) {
      if (matrix[scId] !== undefined) matrix[scId].push(phase.number);
    }
  }
  return matrix;
}

interface ValidationError {
  field: string;
  message: string;
}

function validateDraft(draft: EditorPlan): ValidationError[] {
  const errors: ValidationError[] = [];
  const phaseNumbers = new Set<number>();
  const knownScIds = new Set(draft.successCriteria.map((sc) => sc.id));

  // First pass: collect phase numbers and check title/dup
  for (const phase of draft.phases) {
    if (!phase.title.trim()) {
      errors.push({
        field: `phase-${phase.number}-title`,
        message: "Title is required",
      });
    }
    if (phaseNumbers.has(phase.number)) {
      errors.push({
        field: `phase-${phase.number}-number`,
        message: `Duplicate phase number ${phase.number}`,
      });
    }
    phaseNumbers.add(phase.number);
  }

  // Second pass: dependencies and addressesCriteria refs
  for (const phase of draft.phases) {
    for (const dep of phase.dependencies) {
      if (!phaseNumbers.has(dep)) {
        errors.push({
          field: `phase-${phase.number}-deps`,
          message: `Dependency ${dep} does not reference a known phase`,
        });
      }
    }
    for (const scId of phase.addressesCriteria) {
      if (!knownScIds.has(scId)) {
        errors.push({
          field: `phase-${phase.number}-criteria`,
          message: `Criterion '${scId}' does not exist`,
        });
      }
    }
  }

  return errors;
}

export function PlanEditor({ plan, issueNumber, onClose }: PlanEditorProps) {
  const [draft, setDraft] = useState<EditorPlan>(() => structuredClone(plan));
  const [confirmRemovePhase, setConfirmRemovePhase] = useState<number | null>(
    null,
  );
  const [confirmRemoveSc, setConfirmRemoveSc] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const activeProject = useProjectsStore((s) => s.getActiveProject());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // ---------- Phase 5: derived state ----------
  const coverageMatrix = useMemo(
    () => recomputeCoverageMatrix(draft.phases, draft.successCriteria),
    [draft.phases, draft.successCriteria],
  );
  const errors = useMemo(() => validateDraft(draft), [draft]);

  // First-error-per-field map for inline display in SortablePhaseCard.
  const errorsByField = useMemo(() => {
    const map: Record<string, string> = {};
    for (const err of errors) {
      if (map[err.field] === undefined) map[err.field] = err.message;
    }
    return map;
  }, [errors]);

  async function handleSave() {
    if (errors.length > 0) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const payload = { ...draft, coverageMatrix };
      const tikiPath = activeProject?.path
        ? `${activeProject.path}/.tiki`
        : undefined;
      await invoke("save_plan", { issueNumber, plan: payload, tikiPath });
      onClose();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setIsSaving(false);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setDraft((d) => {
        const oldIdx = d.phases.findIndex((p) => p.number === active.id);
        const newIdx = d.phases.findIndex((p) => p.number === over.id);
        if (oldIdx < 0 || newIdx < 0) return d;
        return { ...d, phases: arrayMove(d.phases, oldIdx, newIdx) };
      });
    }
  }

  // ---------- Success criteria mutators ----------
  function updateScField(
    idx: number,
    field: keyof EditorSuccessCriterion,
    value: string,
  ) {
    setDraft((d) => ({
      ...d,
      successCriteria: d.successCriteria.map((sc, i) =>
        i === idx ? { ...sc, [field]: value } : sc,
      ),
    }));
  }

  function addCriterion() {
    setDraft((d) => ({
      ...d,
      successCriteria: [
        ...d.successCriteria,
        {
          id: "SC" + (d.successCriteria.length + 1),
          category: "",
          description: "",
        },
      ],
    }));
  }

  function removeCriterion(idx: number) {
    setDraft((d) => ({
      ...d,
      successCriteria: d.successCriteria.filter((_, i) => i !== idx),
    }));
    setConfirmRemoveSc(null);
  }

  // ---------- Phase mutators ----------
  function updatePhaseField<K extends keyof EditorPhase>(
    idx: number,
    field: K,
    value: EditorPhase[K],
  ) {
    setDraft((d) => ({
      ...d,
      phases: d.phases.map((p, i) =>
        i === idx ? { ...p, [field]: value } : p,
      ),
    }));
  }

  function addPhase() {
    setDraft((d) => {
      const nextNumber =
        Math.max(0, ...d.phases.map((p) => p.number)) + 1;
      const newPhase: EditorPhase = {
        number: nextNumber,
        title: "",
        status: "pending",
        content: "",
        verification: [],
        files: [],
        addressesCriteria: [],
        dependencies: [],
      };
      return { ...d, phases: [...d.phases, newPhase] };
    });
  }

  function removePhase(phaseNumber: number) {
    setDraft((d) => ({
      ...d,
      phases: d.phases.filter((p) => p.number !== phaseNumber),
    }));
    setConfirmRemovePhase(null);
  }

  // ---------- String array helpers (verification, files) ----------
  function updateStringArrayItem(
    phaseIdx: number,
    field: "verification" | "files",
    itemIdx: number,
    value: string,
  ) {
    setDraft((d) => ({
      ...d,
      phases: d.phases.map((p, i) =>
        i === phaseIdx
          ? {
              ...p,
              [field]: p[field].map((s, j) => (j === itemIdx ? value : s)),
            }
          : p,
      ),
    }));
  }

  function addStringArrayItem(
    phaseIdx: number,
    field: "verification" | "files",
  ) {
    setDraft((d) => ({
      ...d,
      phases: d.phases.map((p, i) =>
        i === phaseIdx ? { ...p, [field]: [...p[field], ""] } : p,
      ),
    }));
  }

  function removeStringArrayItem(
    phaseIdx: number,
    field: "verification" | "files",
    itemIdx: number,
  ) {
    setDraft((d) => ({
      ...d,
      phases: d.phases.map((p, i) =>
        i === phaseIdx
          ? {
              ...p,
              [field]: p[field].filter((_, j) => j !== itemIdx),
            }
          : p,
      ),
    }));
  }

  // ---------- Dependencies (number array) helpers ----------
  function updateDependency(
    phaseIdx: number,
    itemIdx: number,
    rawValue: string,
  ) {
    const parsed = Number(rawValue);
    setDraft((d) => ({
      ...d,
      phases: d.phases.map((p, i) =>
        i === phaseIdx
          ? {
              ...p,
              // Store NaN as 0 placeholder while typing; commit-time skip handled at save time.
              dependencies: p.dependencies.map((dep, j) =>
                j === itemIdx ? (Number.isFinite(parsed) ? parsed : 0) : dep,
              ),
            }
          : p,
      ),
    }));
  }

  function addDependency(phaseIdx: number) {
    setDraft((d) => ({
      ...d,
      phases: d.phases.map((p, i) =>
        i === phaseIdx ? { ...p, dependencies: [...p.dependencies, 0] } : p,
      ),
    }));
  }

  function removeDependency(phaseIdx: number, itemIdx: number) {
    setDraft((d) => ({
      ...d,
      phases: d.phases.map((p, i) =>
        i === phaseIdx
          ? {
              ...p,
              dependencies: p.dependencies.filter((_, j) => j !== itemIdx),
            }
          : p,
      ),
    }));
  }

  // ---------- addressesCriteria toggle ----------
  function toggleAddressesCriteria(phaseIdx: number, scId: string) {
    setDraft((d) => ({
      ...d,
      phases: d.phases.map((p, i) => {
        if (i !== phaseIdx) return p;
        const has = p.addressesCriteria.includes(scId);
        return {
          ...p,
          addressesCriteria: has
            ? p.addressesCriteria.filter((id) => id !== scId)
            : [...p.addressesCriteria, scId],
        };
      }),
    }));
  }

  return (
    <div className="plan-editor">
      <div className="plan-editor-header">
        <h3>Plan Editor — Issue #{issueNumber}</h3>
        <button
          type="button"
          className="plan-editor-close-btn"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {errors.length > 0 && (
        <div className="plan-editor-error-banner">
          {errors.length} validation error{errors.length > 1 ? "s" : ""} — fix
          before saving
        </div>
      )}

      {!showDiff && (
        <div className="plan-editor-save-row">
          <button
            type="button"
            className="plan-editor-review-btn"
            onClick={() => setShowDiff(true)}
            disabled={errors.length > 0}
          >
            Review Changes
          </button>
        </div>
      )}

      {showDiff && (
        <div className="plan-editor-diff">
          <details open>
            <summary className="plan-editor-diff-summary">Original</summary>
            <pre className="plan-editor-diff-pre">
              {JSON.stringify(plan, null, 2)}
            </pre>
          </details>
          <details open>
            <summary className="plan-editor-diff-summary">Edited</summary>
            <pre className="plan-editor-diff-pre">
              {JSON.stringify({ ...draft, coverageMatrix }, null, 2)}
            </pre>
          </details>
          <div className="plan-editor-save-row">
            <button
              type="button"
              className="plan-editor-save-btn"
              onClick={handleSave}
              disabled={isSaving || errors.length > 0}
            >
              {isSaving ? "Saving..." : "Save Plan"}
            </button>
            <button
              type="button"
              className="plan-editor-back-btn"
              onClick={() => setShowDiff(false)}
            >
              Back to Edit
            </button>
            {saveError && (
              <span className="plan-editor-field-error">{saveError}</span>
            )}
          </div>
        </div>
      )}

      {!showDiff && (
        <>
      {/* Success criteria editor */}
      <div className="plan-editor-section">
        <h4 className="plan-editor-section-title">Success Criteria</h4>
        {draft.successCriteria.length === 0 ? (
          <p style={{ fontSize: 12, opacity: 0.7, margin: 0 }}>
            No success criteria defined.
          </p>
        ) : (
          <div className="plan-editor-sc-list">
            {draft.successCriteria.map((sc, idx) => (
              <div key={idx} className="plan-editor-sc-row">
                <input
                  type="text"
                  className="plan-editor-input plan-editor-sc-id-input"
                  value={sc.id}
                  onChange={(e) => updateScField(idx, "id", e.target.value)}
                  placeholder="SC1"
                />
                <input
                  type="text"
                  className="plan-editor-input plan-editor-sc-cat-input"
                  value={sc.category}
                  onChange={(e) =>
                    updateScField(idx, "category", e.target.value)
                  }
                  placeholder="category"
                />
                <input
                  type="text"
                  className="plan-editor-input plan-editor-sc-desc-input"
                  value={sc.description}
                  onChange={(e) =>
                    updateScField(idx, "description", e.target.value)
                  }
                  placeholder="description"
                />
                {confirmRemoveSc === sc.id ? (
                  <div className="plan-editor-confirm-remove">
                    <button
                      type="button"
                      className="plan-editor-remove-btn"
                      onClick={() => removeCriterion(idx)}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="plan-editor-close-btn"
                      onClick={() => setConfirmRemoveSc(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="plan-editor-remove-btn"
                    onClick={() => setConfirmRemoveSc(sc.id)}
                    aria-label="Remove criterion"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          className="plan-editor-add-btn"
          onClick={addCriterion}
        >
          + Add Criterion
        </button>
      </div>

      {/* Phase editor */}
      <div className="plan-editor-section">
        <h4 className="plan-editor-section-title">Phases</h4>
        {draft.phases.length === 0 ? (
          <p style={{ fontSize: 12, opacity: 0.7, margin: 0 }}>
            No phases defined.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={draft.phases.map((p) => p.number)}
              strategy={verticalListSortingStrategy}
            >
              <div className="plan-editor-phases">
                {draft.phases.map((phase, idx) => (
                  <SortablePhaseCard
                    key={phase.number}
                    phase={phase}
                    idx={idx}
                    successCriteria={draft.successCriteria}
                    errorsByField={errorsByField}
                    confirmRemovePhase={confirmRemovePhase}
                    setConfirmRemovePhase={setConfirmRemovePhase}
                    onUpdatePhaseField={updatePhaseField}
                    onRemovePhase={removePhase}
                    onUpdateStringArrayItem={updateStringArrayItem}
                    onAddStringArrayItem={addStringArrayItem}
                    onRemoveStringArrayItem={removeStringArrayItem}
                    onUpdateDependency={updateDependency}
                    onAddDependency={addDependency}
                    onRemoveDependency={removeDependency}
                    onToggleAddressesCriteria={toggleAddressesCriteria}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        <button
          type="button"
          className="plan-editor-add-btn"
          onClick={addPhase}
        >
          + Add Phase
        </button>
      </div>
        </>
      )}
    </div>
  );
}
