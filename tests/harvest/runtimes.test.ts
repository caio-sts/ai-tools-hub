import { describe, expect, it } from 'vitest';
import { RUNTIME_ORDER } from '../../src/lib/safety.ts';
import { TOPIC_RUNTIMES, detectRuntimes } from '../../scripts/harvest/enrich.ts';

describe('detectRuntimes', () => {
  it('maps runtime topics and ignores content topics', () => {
    expect(detectRuntimes(['claude-code', 'security', 'sast'])).toEqual(['claude']);
    expect(detectRuntimes(['openclaw', 'clawhub'])).toEqual(['openclaw']);
    expect(detectRuntimes(['codex-cli'])).toEqual(['codex']);
    expect(detectRuntimes(['cursor-rules'])).toEqual(['cursor']);
  });

  it('returns multiple runtimes in RUNTIME_ORDER, never alphabetically', () => {
    expect(detectRuntimes(['cursor', 'openclaw', 'claude-skills'])).toEqual([
      'claude',
      'openclaw',
      'cursor',
    ]);
    expect(detectRuntimes(['claude-skills', 'openclaw', 'cursor'])).toEqual([
      'claude',
      'openclaw',
      'cursor',
    ]);
    // Alphabetical would be claude, cursor, openclaw — that ordering is a bug, not a variant.
    expect(detectRuntimes(['cursor', 'openclaw'])).toEqual(['openclaw', 'cursor']);
  });

  it('normalises case and whitespace', () => {
    expect(detectRuntimes([' Claude-Code ', 'OPENCLAW'])).toEqual(['claude', 'openclaw']);
  });

  it('falls back to generic rather than inventing a runtime from content words', () => {
    expect(detectRuntimes([])).toEqual(['generic']);
    expect(detectRuntimes(['bash', 'python', 'kubernetes'])).toEqual(['generic']);
  });

  it('publishes its vocabulary and orders by the shared RUNTIME_ORDER', () => {
    expect(detectRuntimes(['cursor', 'codex-cli', 'openclaw', 'claude-code'])).toEqual(
      RUNTIME_ORDER.filter((runtime) => runtime !== 'generic'),
    );
    expect(TOPIC_RUNTIMES['claude-code']).toBe('claude');
    expect(TOPIC_RUNTIMES.openclaw).toBe('openclaw');
  });
});
