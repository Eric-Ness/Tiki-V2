import { describe, expect, it } from 'vitest';
import { getExecuteCommand } from '../executeCommand';

describe('getExecuteCommand', () => {
  it('returns /tiki:execute --continue when resuming paused work from the review column', () => {
    expect(getExecuteCommand(42, 'review', 'paused')).toBe('/tiki:execute 42 --continue');
  });

  it('returns /tiki:execute --continue when resuming failed work from the review column', () => {
    expect(getExecuteCommand(42, 'review', 'failed')).toBe('/tiki:execute 42 --continue');
  });

  it('starts a full /tiki:yolo when reviewing work moves from review to execute', () => {
    expect(getExecuteCommand(42, 'review', 'reviewing')).toBe('/tiki:yolo 42');
  });

  it('starts a full /tiki:yolo when status is undefined and source is review', () => {
    expect(getExecuteCommand(42, 'review')).toBe('/tiki:yolo 42');
  });

  it('starts a full /tiki:yolo when moving from the open column regardless of status', () => {
    expect(getExecuteCommand(42, 'open')).toBe('/tiki:yolo 42');
    expect(getExecuteCommand(42, 'open', 'paused')).toBe('/tiki:yolo 42');
  });

  it('runs /tiki:execute (without yolo) when resuming from the plan column', () => {
    expect(getExecuteCommand(42, 'plan')).toBe('/tiki:execute 42');
  });

  it('runs /tiki:execute when source column is something other than review/open', () => {
    expect(getExecuteCommand(42, 'in-progress')).toBe('/tiki:execute 42');
  });
});
