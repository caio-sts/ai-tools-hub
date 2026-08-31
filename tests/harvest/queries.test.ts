import { describe, expect, it } from 'vitest';
import { MIN_STARS } from '../../src/lib/inclusion.ts';
import {
  buildSearchQueries,
  DISCOVERY_TOPICS,
  STAR_PARTITIONS,
} from '../../scripts/harvest/discover.ts';

describe('buildSearchQueries', () => {
  it('sweeps every topic across every star partition', () => {
    const queries = buildSearchQueries();
    expect(queries).toHaveLength(DISCOVERY_TOPICS.length * STAR_PARTITIONS.length);
    expect(queries).toHaveLength(15);
    expect(queries[0]).toBe('topic:claude-skills stars:>=1000');
    expect(queries[1]).toBe('topic:claude-skills stars:100..999');
    expect(queries[2]).toBe('topic:claude-skills stars:10..99');
    expect(queries).toContain('topic:openclaw-skills stars:100..999');
    expect(queries).toContain('topic:mcp-server stars:10..99');
  });

  it('partitions so no single query can hit the hard 1000-result cap silently', () => {
    expect([...STAR_PARTITIONS]).toEqual(['>=1000', '100..999', '10..99']);
    expect([...DISCOVERY_TOPICS]).toEqual([
      'claude-skills',
      'agent-skills',
      'openclaw-skills',
      'claude-code',
      'mcp-server',
    ]);
  });

  it('derives its lowest band from the one published stars floor', () => {
    expect(MIN_STARS).toBe(10);
    expect(STAR_PARTITIONS[STAR_PARTITIONS.length - 1]).toBe(`${MIN_STARS}..99`);
    for (const q of buildSearchQueries()) {
      expect(q).not.toContain('stars:0');
      expect(q).not.toContain('stars:1..');
    }
  });

  it('accepts explicit topics and partitions', () => {
    expect(buildSearchQueries(['x'], ['10..99'])).toEqual(['topic:x stars:10..99']);
  });
});
