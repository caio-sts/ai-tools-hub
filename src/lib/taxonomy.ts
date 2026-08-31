import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Taxonomy, TaxonomyNode } from '../types.ts';

const TAXONOMY_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/taxonomy.json');

let cached: Taxonomy | null = null;

export function loadTaxonomy(): Taxonomy {
  if (cached === null) {
    cached = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf8')) as Taxonomy;
  }
  return cached;
}

export function flattenTaxonomy(tax: Taxonomy): TaxonomyNode[] {
  const out: TaxonomyNode[] = [];
  for (const domain of tax.domains) {
    out.push(domain);
    for (const child of domain.children ?? []) out.push(child);
  }
  return out;
}
