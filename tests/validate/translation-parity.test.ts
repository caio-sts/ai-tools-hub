import { describe, expect, it } from 'vitest';
import type { Skill } from '../../src/types.ts';
import { loadSkills } from '../../src/lib/data.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkTranslationParity } from '../../scripts/validate-taxonomy.ts';

const tax = loadTaxonomy();

function skill(overrides: Partial<Skill>): Skill {
  return {
    id: 'a/b@sha:SKILL.md',
    type: 'skill',
    name: 'n',
    description: 'Audits a project dependencies for Supply Chain risk using SBOM data.',
    descriptionPt: null,
    longPt: null,
    repo: 'a/b',
    path: 'SKILL.md',
    sha: 'sha',
    updatedDays: 1,
    indexedAt: '2026-08-01T00:00:00.000Z',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['generic'],
    safety: { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: false, declaredTools: null },
    primary: 'security/supply-chain',
    also: [],
    tags: [],
    securityRelevant: true,
    listed: true,
    score: 65,
    breakdown: { adoption: 10, maintenance: 30, provenance: 5, completeness: 20, total: 65 },
    ...overrides,
  };
}

describe('check 8 - translation parity', () => {
  it('passes on the committed catalog', () => {
    expect(checkTranslationParity(tax, loadSkills()).ok).toBe(true);
  });

  it('passes over an untranslated entry, which is a legitimate state', () => {
    expect(checkTranslationParity(tax, [skill({})]).ok).toBe(true);
  });

  it('catches Supply Chain translated as cadeia de suprimentos', () => {
    const result = checkTranslationParity(tax, [
      skill({ descriptionPt: 'Audita as dependências de um projeto quanto a risco de cadeia de suprimentos usando dados de SBOM.' }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('protected term "Supply Chain" is in description');
    expect(result.errors[0]).toContain('a/b@sha:SKILL.md');
  });

  it('catches a dropped SBOM', () => {
    const result = checkTranslationParity(tax, [
      skill({ descriptionPt: 'Audita as dependências de um projeto quanto a risco de Supply Chain usando dados de inventário.' }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('protected term "SBOM"');
  });

  it('checks longPt as well as descriptionPt', () => {
    const result = checkTranslationParity(tax, [
      skill({
        descriptionPt: 'Audita dependências quanto a risco de Supply Chain usando dados de SBOM.',
        longPt: 'Audita dependências quanto a risco de cadeia de suprimentos usando dados de SBOM.',
      }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('longPt');
  });

  it('accepts a faithful translation that keeps every protected term', () => {
    const result = checkTranslationParity(tax, [
      skill({
        descriptionPt: 'Audita as dependências de um projeto quanto a risco de Supply Chain usando dados de SBOM.',
        longPt: 'Audita as dependências de um projeto quanto a risco de Supply Chain usando dados de SBOM.',
      }),
    ]);
    expect(result).toEqual({ name: '8 translation parity', ok: true, errors: [] });
  });

  // trailofbits writes "supply-chain risk" with a hyphen. Matching only the spaced form made the
  // check blind in exactly the case it exists for: the English would not match either, so
  // "cadeia de suprimentos" sailed through with parity intact.
  it('reads a hyphenated English form as the protected term', () => {
    const result = checkTranslationParity(tax, [
      skill({
        description: 'Audits dependencies for supply-chain risk using SBOM data.',
        descriptionPt: 'Audita dependências quanto a risco de cadeia de suprimentos usando dados de SBOM.',
      }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('protected term "Supply Chain" is in description');
  });

  it('accepts the spaced translation of a hyphenated original, which is the same term', () => {
    const result = checkTranslationParity(tax, [
      skill({
        description: 'Audits dependencies for supply-chain risk using SBOM data.',
        descriptionPt: 'Audita dependências quanto a risco de Supply Chain usando dados de SBOM.',
      }),
    ]);
    expect(result.ok).toBe(true);
  });

  it('catches a protected term invented in pt-BR that the English never had', () => {
    const result = checkTranslationParity(tax, [
      skill({
        description: 'Scans a cluster for misconfiguration.',
        descriptionPt: 'Varre um cluster Kubernetes em busca de configuração incorreta.',
      }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('protected term "Kubernetes" is in descriptionPt');
  });
});
