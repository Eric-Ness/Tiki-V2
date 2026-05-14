import { describe, expect, it } from 'vitest';
import { resolveWorkTerminal, type TerminalTab } from './terminalStore';
import { createLeaf, type SplitNode } from './splitTree';

function tab(id: string, splitRoot: TerminalTab['splitRoot'], activeTerminalId: string): TerminalTab {
  return { id, title: id, status: 'ready', splitRoot, activeTerminalId };
}

describe('resolveWorkTerminal', () => {
  const simpleTab = tab('tab-1', createLeaf('term-1'), 'term-1');

  it('returns null when the issue has no recorded association', () => {
    expect(resolveWorkTerminal({}, [simpleTab], 42)).toBeNull();
    expect(resolveWorkTerminal(undefined, [simpleTab], 42)).toBeNull();
  });

  it('returns null when the associated terminal no longer exists in any tab', () => {
    expect(resolveWorkTerminal({ '42': 'term-dead' }, [simpleTab], 42)).toBeNull();
  });

  it('resolves to the tab + terminal when the association points at a live single-leaf tab', () => {
    expect(resolveWorkTerminal({ '42': 'term-1' }, [simpleTab], 42)).toEqual({
      tabId: 'tab-1',
      terminalId: 'term-1',
    });
  });

  it('resolves a terminal that is a non-root leaf inside a split tree', () => {
    const split: SplitNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      children: [createLeaf('term-a'), createLeaf('term-b')],
      sizes: [50, 50],
    };
    const splitTab = tab('tab-2', split, 'term-b');
    expect(resolveWorkTerminal({ '7': 'term-b' }, [simpleTab, splitTab], 7)).toEqual({
      tabId: 'tab-2',
      terminalId: 'term-b',
    });
  });
});
