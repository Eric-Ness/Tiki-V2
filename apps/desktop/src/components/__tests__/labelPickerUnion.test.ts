import { describe, it, expect } from 'vitest';
import { unionLabels } from '../LabelPickerPopover';

describe('unionLabels', () => {
  it('returns empty when issues have no labels', () => {
    expect(unionLabels([{ labels: [] }, { labels: [] }])).toEqual([]);
  });

  it('deduplicates labels by name across issues', () => {
    const out = unionLabels([
      {
        labels: [
          { name: 'bug', color: 'ff0000' },
          { name: 'p1', color: '00ff00' },
        ],
      },
      {
        labels: [
          { name: 'bug', color: 'ff0000' },
          { name: 'p2', color: '0000ff' },
        ],
      },
    ]);
    expect(out.map((l) => l.name).sort()).toEqual(['bug', 'p1', 'p2']);
  });

  it('handles a single issue with multiple labels', () => {
    const out = unionLabels([
      {
        labels: [
          { name: 'a', color: '111111' },
          { name: 'b', color: '222222' },
        ],
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((l) => l.name)).toEqual(['a', 'b']);
  });
});
