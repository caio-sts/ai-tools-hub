import { describe, expect, it } from 'vitest';
import type { Skill, Taxonomy } from '../../src/types.ts';
import { buildFacetGroups, chipLabelMap, sortLabel } from '../../src/lib/facets.ts';
import { skill as baseSkill } from './facets-index.test.ts';

function skill(over: Partial<Skill> = {}): Skill {
  return baseSkill({
    id: 'acme/kit@abc:skills/a/SKILL.md',
    name: 'A',
    runtimes: ['claude'],
    safety: { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: false, declaredTools: null },
    also: [],
    tags: [],
    // score === breakdown.total, every component inside its cap.
    score: 94,
    breakdown: { adoption: 20, maintenance: 29, provenance: 25, completeness: 20, total: 94 },
    ...over,
  });
}

const taxonomy: Taxonomy = {
  domains: [
    {
      slug: 'security',
      name: { en: 'Security', pt: 'Segurança' },
      children: [
        { slug: 'security/supply-chain', name: { en: 'Supply Chain & Dependencies', pt: 'Supply Chain e Dependências' } },
        { slug: 'security/general', name: { en: 'General / Other', pt: 'Geral / Outros' } },
      ],
    },
  ],
  protected: [],
  aliases: {},
  minimumMass: 5,
};

describe('bilingual rail labels', () => {
  const groups = buildFacetGroups([skill()], taxonomy, 'en');
  const groupsPt = buildFacetGroups([skill()], taxonomy, 'pt');

  it('names each rail group from the catalog namespace', () => {
    expect(groups.map((g) => g.label)).toEqual(['Risk & capability', 'Subdomain', 'Runtime', 'License']);
  });

  it('translates the rail into pt-BR', () => {
    expect(groupsPt[0].label).toBe('Risco e capacidade');
    expect(groupsPt[0].options[0].label).toBe('Não executa código');
  });

  it('states the OR semantics of a multi-select group', () => {
    expect(groups[0].hint).toBe('Matches any checked value');
    expect(groupsPt[0].hint).toBe('Corresponde a qualquer valor marcado');
  });

  it('labels every sort tab in both locales', () => {
    expect(sortLabel('score', 'en')).toBe('Score');
    expect(sortLabel('score', 'pt')).toBe('Pontuação');
    expect(sortLabel('updated', 'pt')).toBe('Atualizadas');
  });
});

describe('buildFacetGroups', () => {
  const groups = buildFacetGroups([skill(), skill({ id: 'x', license: null, runtimes: ['codex'] })], taxonomy, 'en');

  it('orders the rail Risk, Subdomain, Runtime, License', () => {
    expect(groups.map((g) => g.key)).toEqual(['risk', 'subdomain', 'runtime', 'license']);
  });

  it('always shows all six risk values, including those at zero', () => {
    expect(groups[0].options.map((o) => o.value)).toEqual([
      'no-code-execution', 'executes-code', 'network', 'reads-env', 'declared-tools', 'portable',
    ]);
    expect(groups[0].options[0].count).toBe(2);
    expect(groups[0].options[1].count).toBe(0);
  });

  it('shows only subdomains that hold at least one entry, labelled from the taxonomy', () => {
    expect(groups[1].options.map((o) => o.value)).toEqual(['security/supply-chain']);
    expect(groups[1].options[0].label).toBe('Supply Chain & Dependencies');
  });

  it('nests subdomains under their domain in the UI, never in the index', () => {
    expect(groups[1].options[0].group).toBe('Security');
    expect(groups[1].key).toBe('subdomain');
  });

  it('shows every runtime in LED order with real counts', () => {
    expect(groups[2].options.map((o) => o.value)).toEqual(['claude', 'openclaw', 'codex', 'cursor', 'generic']);
    expect(groups[2].options.find((o) => o.value === 'codex')?.count).toBe(1);
  });

  it('sorts licenses by count and always names the undeclared state last', () => {
    expect(groups[3].options.map((o) => o.value)).toEqual(['MIT', 'unspecified']);
    expect(groups[3].options[1].label).toBe('Not declared');
  });

  it('localises the undeclared license label', () => {
    const pt = buildFacetGroups([skill({ license: null })], taxonomy, 'pt');
    expect(pt[3].options[0].label).toBe('Não declarada');
  });

  it('counts only listed entries, so no count promises a row the cap evicted', () => {
    const evicted = skill({ id: 'evicted', listed: false, license: null, runtimes: ['codex'] });
    const withEvicted = buildFacetGroups([skill(), evicted], taxonomy, 'en');
    expect(withEvicted[0].options[0].count).toBe(1);
    expect(withEvicted[1].options[0].count).toBe(1);
    expect(withEvicted[2].options.find((o) => o.value === 'codex')?.count).toBe(0);
    expect(withEvicted[3].options.map((o) => o.value)).toEqual(['MIT']);
  });

  it('reads taxonomy names from the argument, so nothing here touches the filesystem', () => {
    const renamed: Taxonomy = {
      ...taxonomy,
      domains: [{ ...taxonomy.domains[0], name: { en: 'Sec', pt: 'Seg' }, children: taxonomy.domains[0].children }],
    };
    expect(buildFacetGroups([skill()], renamed, 'en')[1].options[0].group).toBe('Sec');
  });
});

describe('chipLabelMap', () => {
  const groups = buildFacetGroups([skill({ license: null })], taxonomy, 'en');
  const map = chipLabelMap(groups, taxonomy, 'en');

  it('gives the client a label for every checkable value without shipping i18n tables', () => {
    expect(map.risk['no-code-execution']).toBe('Does not execute code');
    expect(map.subdomain['security/supply-chain']).toBe('Supply Chain & Dependencies');
    expect(map.license.unspecified).toBe('Not declared');
  });

  it('covers domain too, because the home page links into the catalog by domain', () => {
    expect(map.domain.security).toBe('Security');
  });
});
