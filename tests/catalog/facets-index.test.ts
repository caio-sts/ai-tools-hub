import { describe, expect, it } from 'vitest';
import type { Collection, Skill } from '../../src/types.ts';
import {
  INDEX_FILTER_KEYS,
  RAIL_FILTER_KEYS,
  RISK_VALUES,
  RUNTIME_ORDER,
  collectionFor,
  countValues,
  indexValues,
  listedSkills,
  riskValues,
  sortValues,
} from '../../src/lib/facets.ts';

export function skill(over: Partial<Skill> = {}): Skill {
  return {
    id: 'acme/kit@abc123:skills/scan/SKILL.md',
    type: 'skill',
    name: 'Dependency scan',
    description: 'Scans a lockfile for known-malicious packages and prints a report.',
    descriptionPt: null,
    longPt: null,
    repo: 'acme/kit',
    path: 'skills/scan/SKILL.md',
    sha: 'abc123',
    updatedDays: 12,
    indexedAt: '2026-08-29',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['claude', 'generic'],
    safety: {
      executesCode: true,
      scriptCount: 2,
      languages: ['python'],
      network: true,
      readsEnv: false,
      declaredTools: ['Bash'],
    },
    primary: 'security/supply-chain',
    also: ['devops-infra/general'],
    tags: ['sbom'],
    securityRelevant: true,
    // §5.1: false once the per-subdomain cap evicts it. The row survives, the listing does not.
    listed: true,
    // score === breakdown.total, every component inside its 25/30/25/20 cap.
    score: 91,
    breakdown: { adoption: 20, maintenance: 26, provenance: 25, completeness: 20, total: 91 },
    ...over,
  };
}

describe('filter key vocabulary', () => {
  it('indexes five flat parallel keys', () => {
    expect([...INDEX_FILTER_KEYS]).toEqual(['domain', 'subdomain', 'runtime', 'risk', 'license']);
  });

  it('orders the rail by decision frequency with risk first', () => {
    expect([...RAIL_FILTER_KEYS]).toEqual(['risk', 'subdomain', 'runtime', 'license']);
  });

  it('never uses a Pagefind reserved word as a key or a risk value', () => {
    const reserved = ['all', 'any', 'none', 'not'];
    for (const key of INDEX_FILTER_KEYS) expect(reserved).not.toContain(key);
    for (const value of RISK_VALUES) expect(reserved).not.toContain(value);
  });

  it('lists runtimes in LED order, never alphabetically', () => {
    expect([...RUNTIME_ORDER]).toEqual(['claude', 'openclaw', 'codex', 'cursor', 'generic']);
  });
});

describe('riskValues', () => {
  it('emits the positive "no-code-execution" value so hiding executors is one checkbox', () => {
    const safe = { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: false, declaredTools: null };
    expect(riskValues(safe, false)).toEqual(['no-code-execution']);
  });

  it('emits every capability the safety surface actually found', () => {
    expect(riskValues(skill().safety, true)).toEqual(['executes-code', 'network', 'declared-tools', 'portable']);
  });

  it('treats an empty declaredTools array as not declared', () => {
    const s = { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: true, declaredTools: [] };
    expect(riskValues(s, false)).toEqual(['no-code-execution', 'reads-env']);
  });
});

describe('indexValues', () => {
  it('flattens primary and also into parallel domain and subdomain keys', () => {
    const v = indexValues(skill());
    expect(v.domain).toEqual(['security', 'devops-infra']);
    expect(v.subdomain).toEqual(['security/supply-chain', 'devops-infra/general']);
  });

  it('carries runtimes verbatim and risk from the safety surface', () => {
    const v = indexValues(skill());
    expect(v.runtime).toEqual(['claude', 'generic']);
    expect(v.risk).toEqual(['executes-code', 'network', 'declared-tools', 'portable']);
  });

  it('names the missing-license state rather than dropping it', () => {
    expect(indexValues(skill({ license: null })).license).toEqual(['unspecified']);
  });

  it('de-duplicates a domain shared by primary and also', () => {
    const v = indexValues(skill({ primary: 'security/supply-chain', also: ['security/cicd-pipeline'] }));
    expect(v.domain).toEqual(['security']);
  });
});

describe('listedSkills', () => {
  it('drops the entries the per-subdomain cap evicted', () => {
    const kept = skill();
    const evicted = skill({ id: 'acme/kit@abc123:skills/old/SKILL.md', listed: false });
    expect(listedSkills([kept, evicted])).toEqual([kept]);
  });

  it('keeps everything when nothing was evicted, without mutating the input', () => {
    const all = [skill(), skill({ id: 'acme/kit@abc123:skills/two/SKILL.md' })];
    expect(listedSkills(all)).toEqual(all);
    expect(all).toHaveLength(2);
  });
});

describe('countValues', () => {
  it('counts each skill once per distinct value', () => {
    const skills = [skill(), skill({ id: 'b', primary: 'security/cicd-pipeline', also: [] })];
    const counts = countValues(skills, 'subdomain');
    expect(counts.get('security/supply-chain')).toBe(1);
    expect(counts.get('security/cicd-pipeline')).toBe(1);
    expect(counts.get('devops-infra/general')).toBe(1);
  });
});

describe('sortValues', () => {
  const collection: Collection = {
    repo: 'acme/kit',
    stars: 6908,
    forks: 123,
    pushedAt: '2026-08-20T00:00:00.000Z',
    license: 'MIT',
    topics: ['agent-skills'],
    isOrg: true,
    curated: true,
  };

  it('zero-pads so Pagefind string sorting matches numeric order', () => {
    expect(sortValues(skill(), collection)).toEqual({
      score: '091',
      stars: '000006908',
      forks: '000000123',
      newest: '20260829',
      updated: '000012',
    });
  });

  it('falls back to zeroes when the repo has no collection record', () => {
    const v = sortValues(skill(), null);
    expect(v.stars).toBe('000000000');
    expect(v.forks).toBe('000000000');
  });

  it('refuses to invent a date from a malformed indexedAt', () => {
    expect(sortValues(skill({ indexedAt: 'not-a-date' }), null).newest).toBe('00000000');
  });
});

describe('collectionFor', () => {
  it('finds a collection by repo and returns null when absent', () => {
    const c: Collection = {
      repo: 'acme/kit', stars: 1, forks: 0, pushedAt: '2026-01-01T00:00:00.000Z',
      license: null, topics: [], isOrg: false, curated: false,
    };
    expect(collectionFor('acme/kit', [c])).toBe(c);
    expect(collectionFor('other/repo', [c])).toBeNull();
  });
});
