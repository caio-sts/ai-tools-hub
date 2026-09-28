import { describe, expect, it } from 'vitest';
import { MIN_STARS } from '../../src/lib/inclusion.ts';
import {
  buildSearchQueries,
  DISCOVERY_TOPICS,
  STAR_PARTITIONS,
  TOPIC_PARTITIONS,
} from '../../scripts/harvest/discover.ts';

describe('buildSearchQueries', () => {
  it('sweeps every topic across its star partitions', () => {
    const queries = buildSearchQueries();
    expect(queries).toHaveLength(11);
    expect(queries[0]).toBe('topic:claude-skills stars:>=1000');
    expect(queries[1]).toBe('topic:claude-skills stars:100..999');
    expect(queries[2]).toBe('topic:claude-skills stars:10..99');
    expect(queries).toContain('topic:openclaw-skills stars:100..999');
    expect(queries).toContain('topic:claude-code stars:100..999');
  });

  it('keeps claude-code above 100 stars and drops mcp-server entirely (2026-09-27 cut)', () => {
    const queries = buildSearchQueries();
    expect(queries).not.toContain('topic:claude-code stars:10..99');
    expect(queries.some((q) => q.includes('mcp-server'))).toBe(false);
  });

  it('partitions so no single query can hit the hard 1000-result cap silently', () => {
    expect([...STAR_PARTITIONS]).toEqual(['>=1000', '100..999', '10..99']);
    expect([...DISCOVERY_TOPICS]).toEqual(['claude-skills', 'agent-skills', 'openclaw-skills', 'claude-code']);
  });

  it('lets a topic raise its own floor, never lower it', () => {
    for (const partitions of Object.values(TOPIC_PARTITIONS)) {
      for (const partition of partitions) expect(STAR_PARTITIONS).toContain(partition);
    }
  });

  it('derives its lowest band from the one published stars floor', () => {
    expect(MIN_STARS).toBe(10);
    expect(STAR_PARTITIONS[STAR_PARTITIONS.length - 1]).toBe(`${MIN_STARS}..99`);
    for (const q of buildSearchQueries()) {
      expect(q).not.toContain('stars:0');
      expect(q).not.toContain('stars:1..');
    }
  });

  it('accepts explicit topics, partitions and overrides', () => {
    expect(buildSearchQueries(['x'], ['10..99'])).toEqual(['topic:x stars:10..99']);
    expect(buildSearchQueries(['x', 'y'], ['10..99', '>=1000'], { y: ['>=1000'] })).toEqual([
      'topic:x stars:10..99',
      'topic:x stars:>=1000',
      'topic:y stars:>=1000',
    ]);
  });
});
