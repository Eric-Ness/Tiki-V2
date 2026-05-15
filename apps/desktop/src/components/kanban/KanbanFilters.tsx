import { memo, useMemo } from 'react';
import { useKanbanStore, useProjectsStore, useSelectionStore, useTikiReleasesStore } from '../../stores';

export const KanbanFilters = memo(function KanbanFilters() {
  const projectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';
  const releaseFilter = useKanbanStore((s) => s.releaseFilterByProject[projectId] ?? null);
  const setReleaseFilter = useKanbanStore((s) => s.setReleaseFilter);
  const releases = useTikiReleasesStore((s) => s.releases);
  const activeReleases = useMemo(() => releases.filter((r) => r.status === 'active'), [releases]);
  const selectionCount = useSelectionStore(
    (s) => s.selectedByProject[projectId]?.size ?? 0,
  );
  const clearSelection = useSelectionStore((s) => s.clear);

  return (
    <div className="kanban-filters">
      <label className="kanban-filters-label">Filter:</label>
      <select
        className="kanban-filters-select"
        value={releaseFilter || ''}
        onChange={(e) => setReleaseFilter(e.target.value || null)}
      >
        <option value="">All Issues</option>
        <option value="unassigned">Unassigned</option>
        {activeReleases.length > 0 && (
          <optgroup label="Releases">
            {activeReleases.map((release) => (
              <option key={release.version} value={release.version}>
                {release.version}
                {release.name ? ` - ${release.name}` : ''}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {selectionCount > 0 && (
        <div className="kanban-selection-status">
          <span className="kanban-selection-count">{selectionCount} selected</span>
          <button
            type="button"
            className="kanban-selection-clear"
            onClick={clearSelection}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
});
