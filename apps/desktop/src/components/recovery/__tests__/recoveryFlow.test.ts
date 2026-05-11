import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatRelativeAge,
  parseBackupTimestamp,
  RESET_CONFIRMATION_PHRASE,
  validateBackupShape,
} from '../recoveryFlow';

describe('parseBackupTimestamp', () => {
  it('parses a well-formed timestamp into a UTC Date', () => {
    const d = parseBackupTimestamp('2026-05-11T16-30-00');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-05-11T16:30:00.000Z');
  });

  it('returns null for malformed input', () => {
    expect(parseBackupTimestamp('not-a-timestamp')).toBeNull();
    expect(parseBackupTimestamp('2026-05-11')).toBeNull();
    expect(parseBackupTimestamp('2026-05-11T16:30:00')).toBeNull();
    expect(parseBackupTimestamp('')).toBeNull();
  });

  it('rejects out-of-range components', () => {
    expect(parseBackupTimestamp('2026-13-11T16-30-00')).toBeNull(); // month 13
    expect(parseBackupTimestamp('2026-05-32T16-30-00')).toBeNull(); // day 32
    expect(parseBackupTimestamp('2026-05-11T25-30-00')).toBeNull(); // hour 25
    expect(parseBackupTimestamp('2026-05-11T16-60-00')).toBeNull(); // minute 60
    expect(parseBackupTimestamp('2026-05-11T16-30-60')).toBeNull(); // second 60
  });
});

describe('formatRelativeAge', () => {
  const now = new Date('2026-05-11T16:30:00.000Z');

  it('returns "just now" for very recent timestamps', () => {
    expect(formatRelativeAge(new Date('2026-05-11T16:29:30.000Z'), now)).toBe('just now');
    expect(formatRelativeAge(new Date('2026-05-11T16:30:00.000Z'), now)).toBe('just now');
  });

  it('formats minutes', () => {
    expect(formatRelativeAge(new Date('2026-05-11T16:25:00.000Z'), now)).toBe('5 minutes ago');
    expect(formatRelativeAge(new Date('2026-05-11T16:29:00.000Z'), now)).toBe('1 minute ago');
  });

  it('formats hours', () => {
    expect(formatRelativeAge(new Date('2026-05-11T13:30:00.000Z'), now)).toBe('3 hours ago');
    expect(formatRelativeAge(new Date('2026-05-11T15:30:00.000Z'), now)).toBe('1 hour ago');
  });

  it('formats days', () => {
    expect(formatRelativeAge(new Date('2026-05-09T16:30:00.000Z'), now)).toBe('2 days ago');
    expect(formatRelativeAge(new Date('2026-05-10T16:30:00.000Z'), now)).toBe('1 day ago');
  });

  it('formats months and years', () => {
    expect(formatRelativeAge(new Date('2026-03-11T16:30:00.000Z'), now)).toBe('2 months ago');
    expect(formatRelativeAge(new Date('2025-05-11T16:30:00.000Z'), now)).toBe('1 year ago');
    expect(formatRelativeAge(new Date('2023-05-11T16:30:00.000Z'), now)).toBe('3 years ago');
  });

  it('treats future timestamps as "just now"', () => {
    expect(formatRelativeAge(new Date('2026-05-11T17:30:00.000Z'), now)).toBe('just now');
  });
});

describe('formatBytes', () => {
  it('formats bytes under 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10240)).toBe('10.0 KB');
  });

  it('formats MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });

  it('formats GB', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('returns dash for invalid input', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
    expect(formatBytes(Infinity)).toBe('—');
  });
});

describe('validateBackupShape', () => {
  it('accepts a minimal canonical state', () => {
    const result = validateBackupShape('{"schemaVersion":1,"activeWork":{}}');
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('accepts a state with content in activeWork', () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      activeWork: { 'issue:1': { type: 'issue' } },
      history: { recentIssues: [] },
    });
    expect(validateBackupShape(json).ok).toBe(true);
  });

  it('rejects unparseable JSON', () => {
    const result = validateBackupShape('{ not valid json');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a JSON array at the root', () => {
    const result = validateBackupShape('[]');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Root must be an object/);
  });

  it('rejects missing schemaVersion', () => {
    const result = validateBackupShape('{"activeWork":{}}');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/schemaVersion/);
  });

  it('rejects schemaVersion of wrong type', () => {
    const result = validateBackupShape('{"schemaVersion":"1","activeWork":{}}');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/schemaVersion/);
  });

  it('rejects missing activeWork', () => {
    const result = validateBackupShape('{"schemaVersion":1}');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/activeWork/);
  });

  it('rejects activeWork as array', () => {
    const result = validateBackupShape('{"schemaVersion":1,"activeWork":[]}');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/activeWork/);
  });

  it('rejects null root', () => {
    const result = validateBackupShape('null');
    expect(result.ok).toBe(false);
  });
});

describe('RESET_CONFIRMATION_PHRASE', () => {
  it('is exactly "reset" — required by SC5', () => {
    expect(RESET_CONFIRMATION_PHRASE).toBe('reset');
  });
});
