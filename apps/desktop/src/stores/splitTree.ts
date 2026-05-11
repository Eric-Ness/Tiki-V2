// Pure split-tree helpers extracted from terminalStore.ts so they can be
// unit-tested without instantiating the Zustand `persist` middleware (which
// touches localStorage and would explode under a node test environment).
//
// All functions here are pure — they take a tree node and return a new one,
// never mutating inputs. `regenerateLeafIds` accepts the ID generator as a
// parameter so tests can pass a deterministic counter.

export type SplitDirection = 'horizontal' | 'vertical';

export interface TerminalLeaf {
  type: 'terminal';
  terminalId: string;
}

export interface SplitNode {
  type: 'split';
  id: string;
  direction: SplitDirection;
  children: SplitTreeNode[];
  sizes: number[];
}

export type SplitTreeNode = TerminalLeaf | SplitNode;

/** Create a leaf node holding the given terminal id. */
export const createLeaf = (terminalId: string): TerminalLeaf => ({
  type: 'terminal',
  terminalId,
});

/**
 * Find the leaf whose `terminalId === targetId` and replace it with
 * `replacement`. Returns a new tree; never mutates the input.
 */
export const replaceInTree = (
  node: SplitTreeNode,
  targetId: string,
  replacement: SplitTreeNode
): SplitTreeNode => {
  if (node.type === 'terminal') {
    return node.terminalId === targetId ? replacement : node;
  }

  return {
    ...node,
    children: node.children.map((child) =>
      replaceInTree(child, targetId, replacement)
    ),
  };
};

/**
 * Remove the leaf whose `terminalId === targetId`. If a split node ends up
 * with a single child after removal, that child is promoted up (the split
 * collapses). Sibling sizes are normalized to sum to 100 again.
 *
 * Returns `null` if the entire tree was the target leaf.
 * Returns the unchanged tree if the target was not found.
 */
export const removeFromTree = (
  node: SplitTreeNode,
  targetId: string
): SplitTreeNode | null => {
  if (node.type === 'terminal') {
    return node.terminalId === targetId ? null : node;
  }

  const newChildren: SplitTreeNode[] = [];
  const newSizes: number[] = [];
  let removedIndex = -1;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const result = removeFromTree(child, targetId);

    if (result === null) {
      // This child was removed
      removedIndex = i;
    } else {
      newChildren.push(result);
      newSizes.push(node.sizes[i]);
    }
  }

  // If nothing was removed, return unchanged
  if (removedIndex === -1) {
    return node;
  }

  // If only one child left, promote it
  if (newChildren.length === 1) {
    return newChildren[0];
  }

  // Redistribute sizes proportionally
  const totalSize = newSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = newSizes.map((s) => (s / totalSize) * 100);

  return {
    ...node,
    children: newChildren,
    sizes: normalizedSizes,
  };
};

/** Return every terminal id in a depth-first walk of the tree. */
export const getTerminalIds = (node: SplitTreeNode): string[] => {
  if (node.type === 'terminal') {
    return [node.terminalId];
  }
  return node.children.flatMap(getTerminalIds);
};

/**
 * Deep-clone the tree, replacing every leaf's terminalId with a fresh id
 * produced by `generateId`. Used by terminalStore's `partialize` so the
 * persisted IDs never collide with anything in the Rust TerminalManager on
 * the next process load (PTY sessions don't survive a restart).
 *
 * `generateId` is injected so tests can use a deterministic counter.
 */
export const regenerateLeafIds = (
  node: SplitTreeNode,
  generateId: () => string
): SplitTreeNode => {
  if (node.type === 'terminal') {
    return { type: 'terminal', terminalId: generateId() };
  }
  return {
    ...node,
    children: node.children.map((c) => regenerateLeafIds(c, generateId)),
  };
};

/** Return the terminalId of the first leaf in a depth-first walk. */
export const firstLeafId = (node: SplitTreeNode): string => {
  if (node.type === 'terminal') {
    return node.terminalId;
  }
  return firstLeafId(node.children[0]);
};
