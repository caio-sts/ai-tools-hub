import { describe, expect, it } from 'vitest';
import {
  capPerPublisherPerConcept,
  normalizeConcept,
  publisherOf,
} from '../../src/lib/inclusion.ts';

interface Entry {
  repo: string;
  name: string;
  primary: string;
}

const keyByName = (e: Entry) => ({
  publisher: publisherOf(e.repo),
  concept: normalizeConcept(e.name),
});

describe('publisherOf', () => {
  it('is the owner segment, lowercased', () => {
    expect(publisherOf('AliRezaRezvani/claude-skills')).toBe('alirezarezvani');
    expect(publisherOf('anthropics/skills')).toBe('anthropics');
  });

  it('tolerates a bare name with no slash', () => {
    expect(publisherOf('solo')).toBe('solo');
  });
});

describe('normalizeConcept', () => {
  it('folds case, punctuation and spacing to one slug', () => {
    expect(normalizeConcept('PDF Processing')).toBe('pdf-processing');
    expect(normalizeConcept('pdf_processing')).toBe('pdf-processing');
    expect(normalizeConcept('  --PDF--processing--  ')).toBe('pdf-processing');
  });
});

describe('capPerPublisherPerConcept', () => {
  it('keeps one entry per publisher per concept, in first-seen order', () => {
    const entries: Entry[] = [
      { repo: 'mono/skills', name: 'PDF Processing', primary: 'documents' },
      { repo: 'mono/skills', name: 'pdf-processing', primary: 'documents' },
      { repo: 'mono/skills', name: 'lockfile-audit', primary: 'security' },
      { repo: 'other/skills', name: 'pdf-processing', primary: 'documents' },
    ];

    expect(capPerPublisherPerConcept(entries, keyByName).map((e) => e.repo + ':' + e.name)).toEqual([
      'mono/skills:PDF Processing',
      'mono/skills:lockfile-audit',
      'other/skills:pdf-processing',
    ]);
  });

  it('honours an explicit limit above one', () => {
    const entries: Entry[] = [
      { repo: 'mono/skills', name: 'a', primary: 'p' },
      { repo: 'mono/skills', name: 'a', primary: 'p' },
      { repo: 'mono/skills', name: 'a', primary: 'p' },
    ];
    expect(capPerPublisherPerConcept(entries, keyByName, 2)).toHaveLength(2);
  });

  it('is the same function a category page applies with concept = primary', () => {
    const entries: Entry[] = Array.from({ length: 40 }, (_, i) => ({
      repo: 'mono/skills',
      name: `skill-${i}`,
      primary: 'security/supply-chain',
    }));
    entries.push({ repo: 'other/skills', name: 'x', primary: 'security/supply-chain' });

    const capped = capPerPublisherPerConcept(entries, (e) => ({
      publisher: publisherOf(e.repo),
      concept: e.primary,
    }));
    expect(capped).toHaveLength(2);
    expect(capped.map((e) => e.repo)).toEqual(['mono/skills', 'other/skills']);
  });

  it('handles an empty list', () => {
    expect(capPerPublisherPerConcept([] as Entry[], keyByName)).toEqual([]);
  });
});
