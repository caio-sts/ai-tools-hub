import { describe, expect, it } from 'vitest';
import { parseEnrichResponse } from '../../scripts/harvest/enrich.ts';

const CURATED = new Set(['anthropics/skills']);

describe('parseEnrichResponse', () => {
  it('maps each alias back onto its requested repo', () => {
    const result = parseEnrichResponse(
      {
        data: {
          rateLimit: { cost: 13, remaining: 4871 },
          r0: {
            nameWithOwner: 'anthropics/skills',
            stargazerCount: 172473,
            forkCount: 9012,
            pushedAt: '2026-08-27T11:04:00Z',
            licenseInfo: null,
            repositoryTopics: { nodes: [{ topic: { name: 'Claude-Code' } }, { topic: { name: 'agent-skills' } }] },
            owner: { __typename: 'Organization' },
          },
          r1: {
            nameWithOwner: 'someone/personal-skills',
            stargazerCount: 42,
            forkCount: 3,
            pushedAt: '2026-06-01T00:00:00Z',
            licenseInfo: { spdxId: 'MIT' },
            repositoryTopics: { nodes: [] },
            owner: { __typename: 'User' },
          },
        },
      },
      [
        { repo: 'anthropics/skills', stars: 170000 },
        { repo: 'someone/personal-skills', stars: 42 },
      ],
      CURATED,
    );

    expect(result.remaining).toBe(4871);
    expect(result.missing).toEqual([]);
    expect(result.collections).toEqual([
      {
        repo: 'anthropics/skills',
        stars: 172473,
        forks: 9012,
        pushedAt: '2026-08-27T11:04:00Z',
        license: null,
        topics: ['claude-code', 'agent-skills'],
        isOrg: true,
        curated: true,
      },
      {
        repo: 'someone/personal-skills',
        stars: 42,
        forks: 3,
        pushedAt: '2026-06-01T00:00:00Z',
        license: 'MIT',
        topics: [],
        isOrg: false,
        curated: false,
      },
    ]);
  });

  it('reports a null node as missing instead of failing the batch', () => {
    const result = parseEnrichResponse(
      {
        data: {
          rateLimit: { cost: 13, remaining: 4800 },
          r0: null,
          r1: {
            nameWithOwner: 'live/repo',
            stargazerCount: 7,
            forkCount: 0,
            pushedAt: '2026-08-01T00:00:00Z',
            licenseInfo: { spdxId: 'NOASSERTION' },
            repositoryTopics: null,
            owner: { __typename: 'User' },
          },
        },
        errors: [{ message: "Could not resolve to a Repository with the name 'gone/repo'." }],
      },
      [
        { repo: 'gone/repo', stars: 12 },
        { repo: 'live/repo', stars: 7 },
      ],
      CURATED,
    );

    expect(result.missing).toEqual(['gone/repo']);
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].repo).toBe('live/repo');
    expect(result.collections[0].license).toBe('NOASSERTION');
    expect(result.collections[0].topics).toEqual([]);
  });

  it('throws loudly when the whole response carries no data', () => {
    expect(() =>
      parseEnrichResponse(
        { data: null, errors: [{ message: 'Bad credentials' }] },
        [{ repo: 'a/b', stars: 1 }],
        CURATED,
      ),
    ).toThrow('enrich: GraphQL response carried no data (Bad credentials)');
  });
});
