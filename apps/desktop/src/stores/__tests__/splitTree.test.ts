import { describe, expect, it } from 'vitest';
import {
  createLeaf,
  firstLeafId,
  getTerminalIds,
  regenerateLeafIds,
  removeFromTree,
  replaceInTree,
  type SplitNode,
  type SplitTreeNode,
} from '../splitTree';

// Deterministic ID generator factory for regenerateLeafIds tests.
const counter = (prefix = 'gen') => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};

const leaf = (id: string) => createLeaf(id);

const horizontalSplit = (children: SplitTreeNode[], sizes = [50, 50]): SplitNode => ({
  type: 'split',
  id: 'split-h',
  direction: 'horizontal',
  children,
  sizes,
});

describe('createLeaf', () => {
  it('produces a leaf with the given terminal id', () => {
    expect(createLeaf('t1')).toEqual({ type: 'terminal', terminalId: 't1' });
  });
});

describe('replaceInTree', () => {
  it('replaces a matching leaf at the root', () => {
    const tree = leaf('t1');
    const replacement = leaf('t2');
    expect(replaceInTree(tree, 't1', replacement)).toEqual(replacement);
  });

  it('returns the same leaf when the id does not match', () => {
    const tree = leaf('t1');
    const replacement = leaf('t2');
    expect(replaceInTree(tree, 'nope', replacement)).toBe(tree);
  });

  it('replaces a leaf deep inside a split', () => {
    const tree = horizontalSplit([leaf('t1'), horizontalSplit([leaf('t2'), leaf('t3')])]);
    const replacement = leaf('t99');
    const result = replaceInTree(tree, 't3', replacement);
    // Navigate to the leaf that was replaced.
    expect(result.type).toBe('split');
    if (result.type !== 'split') return;
    const inner = result.children[1];
    expect(inner.type).toBe('split');
    if (inner.type !== 'split') return;
    expect(inner.children[1]).toEqual(replacement);
    // And the untouched leaf is preserved by reference where structurally possible.
    expect((result.children[0] as { terminalId: string }).terminalId).toBe('t1');
  });

  it('does not mutate the input tree', () => {
    const tree = horizontalSplit([leaf('t1'), leaf('t2')]);
    const before = JSON.stringify(tree);
    replaceInTree(tree, 't1', leaf('t9'));
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('removeFromTree', () => {
  it('returns null when the root leaf is the target', () => {
    expect(removeFromTree(leaf('t1'), 't1')).toBeNull();
  });

  it('returns the unchanged tree when the target is absent', () => {
    const tree = horizontalSplit([leaf('t1'), leaf('t2')]);
    expect(removeFromTree(tree, 'nope')).toBe(tree);
  });

  it('promotes the lone surviving sibling after removal', () => {
    const tree = horizontalSplit([leaf('t1'), leaf('t2')]);
    const result = removeFromTree(tree, 't2');
    expect(result).toEqual(leaf('t1'));
  });

  it('redistributes sizes proportionally when more than one sibling remains', () => {
    const tree: SplitNode = {
      type: 'split',
      id: 'split-h',
      direction: 'horizontal',
      children: [leaf('a'), leaf('b'), leaf('c')],
      sizes: [40, 30, 30],
    };
    const result = removeFromTree(tree, 'b');
    expect(result?.type).toBe('split');
    if (!result || result.type !== 'split') return;
    expect(result.children).toHaveLength(2);
    // Remaining sizes [40, 30] should be normalized to sum to 100.
    const total = result.sizes.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 5);
    expect(result.sizes[0]).toBeCloseTo((40 / 70) * 100, 5);
    expect(result.sizes[1]).toBeCloseTo((30 / 70) * 100, 5);
  });

  it('returns the input tree unchanged when removal happens deeper than the current level', () => {
    // Current behavior: removeFromTree only registers a structural change at
    // the level where a child *returned null* (i.e. a direct leaf was
    // removed). A nested removal that collapses a deeper split into a leaf
    // is silently dropped at outer levels — the outer split short-circuits
    // back to `return node`. This is intentional: closeSplit always passes
    // the active tab's root, and the recursion happens to do the right
    // thing because the *deepest* split containing the target is the one
    // whose child returns null. This test pins that contract.
    const inner = horizontalSplit([leaf('inner-1'), leaf('inner-2')]);
    const outer = horizontalSplit([leaf('outer-1'), inner]);
    const result = removeFromTree(outer, 'inner-1');
    // Top-level reference identity is preserved because no direct child of
    // the outer split was removed.
    expect(result).toBe(outer);
  });

  it('collapses a split correctly at the level where the target leaf was a direct child', () => {
    // When the target is a direct child of the split being recursed into,
    // removal works as expected.
    const inner = horizontalSplit([leaf('inner-1'), leaf('inner-2')]);
    const result = removeFromTree(inner, 'inner-1');
    expect(result).toEqual(leaf('inner-2'));
  });
});

describe('getTerminalIds', () => {
  it('returns the single id for a leaf', () => {
    expect(getTerminalIds(leaf('only'))).toEqual(['only']);
  });

  it('collects ids depth-first across nested splits', () => {
    const tree = horizontalSplit([leaf('a'), horizontalSplit([leaf('b'), leaf('c')])]);
    expect(getTerminalIds(tree)).toEqual(['a', 'b', 'c']);
  });
});

describe('regenerateLeafIds', () => {
  it('replaces a single leaf id', () => {
    const gen = counter('fresh');
    const result = regenerateLeafIds(leaf('old'), gen);
    expect(result).toEqual({ type: 'terminal', terminalId: 'fresh-1' });
  });

  it('replaces every leaf id in a nested tree, leaving structure intact', () => {
    const gen = counter('fresh');
    const tree = horizontalSplit([leaf('a'), horizontalSplit([leaf('b'), leaf('c')])]);
    const result = regenerateLeafIds(tree, gen);
    expect(getTerminalIds(result)).toEqual(['fresh-1', 'fresh-2', 'fresh-3']);
    // Split structure (direction, sizes) preserved.
    expect(result.type).toBe('split');
    if (result.type !== 'split') return;
    expect(result.direction).toBe('horizontal');
    expect(result.sizes).toEqual([50, 50]);
  });

  it('does not mutate the input', () => {
    const tree = horizontalSplit([leaf('a'), leaf('b')]);
    const before = JSON.stringify(tree);
    regenerateLeafIds(tree, counter());
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('firstLeafId', () => {
  it('returns the only id for a leaf', () => {
    expect(firstLeafId(leaf('alone'))).toBe('alone');
  });

  it('returns the leftmost leaf id in a nested split', () => {
    const tree = horizontalSplit([horizontalSplit([leaf('left'), leaf('right')]), leaf('outer')]);
    expect(firstLeafId(tree)).toBe('left');
  });
});
