import { describe, expect, it } from 'vitest';
import {
  ENRICH_BATCH_SIZE,
  buildEnrichQuery,
  repoAlias,
  splitRepo,
} from '../../scripts/harvest/enrich.ts';

describe('buildEnrichQuery', () => {
  it('emits one alias per repo plus every field enrichment needs', () => {
    const query = buildEnrichQuery([
      { repo: 'anthropics/skills', stars: 172473 },
      { repo: 'VoltAgent/awesome-openclaw-skills', stars: 52244 },
    ]);
    expect(query).toContain('r0: repository(owner: "anthropics", name: "skills") { ...repoFields }');
    expect(query).toContain(
      'r1: repository(owner: "VoltAgent", name: "awesome-openclaw-skills") { ...repoFields }',
    );
    expect(query).toContain('  rateLimit { cost remaining }');
    expect(query).toContain('  stargazerCount');
    expect(query).toContain('  forkCount');
    expect(query).toContain('  pushedAt');
    expect(query).toContain('  licenseInfo { spdxId }');
    expect(query).toContain('  repositoryTopics(first: 25) { nodes { topic { name } } }');
    expect(query).toContain('  owner { __typename }');
    expect(query.startsWith('fragment repoFields on Repository {')).toBe(true);
  });

  it('caps a batch at 50 aliases', () => {
    const many = Array.from({ length: ENRICH_BATCH_SIZE + 1 }, (_, i) => ({
      repo: `owner/repo-${i}`,
      stars: 10,
    }));
    expect(() => buildEnrichQuery(many)).toThrow('exceeds ENRICH_BATCH_SIZE 50');
    expect(() => buildEnrichQuery(many.slice(0, ENRICH_BATCH_SIZE))).not.toThrow();
  });

  it('rejects an empty batch and a malformed repo reference', () => {
    expect(() => buildEnrichQuery([])).toThrow('empty batch');
    expect(() => buildEnrichQuery([{ repo: 'not-a-repo', stars: 1 }])).toThrow(
      'invalid repo reference "not-a-repo"',
    );
    expect(() => buildEnrichQuery([{ repo: 'a/b/c', stars: 1 }])).toThrow('invalid repo reference');
  });

  it('exposes deterministic aliases and a repo splitter', () => {
    expect(repoAlias(0)).toBe('r0');
    expect(repoAlias(49)).toBe('r49');
    expect(splitRepo('anthropics/skills')).toEqual({ owner: 'anthropics', name: 'skills' });
  });
});
