import { useKanbanStore, useTikiReleasesStore } from '../../stores';

export function KanbanFilters() {
  const releaseFilter = useKanbanStore((s) => s.releaseFilter);
  const setReleaseFilter = useKanbanStore((s) => s.setReleaseFilter);
  const releases = useTikiReleasesStore((s) => s.releases);
  const activeReleases = releases.filter((r) => r.status === 'active');

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
                {release.title ? ` - ${release.title}` : ''}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
