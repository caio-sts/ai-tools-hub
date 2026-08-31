import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Lang, Taxonomy, TaxonomyNode } from '../types.ts';

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

export function nodeName(slug: string, lang: Lang): string {
  const node = flattenTaxonomy(loadTaxonomy()).find((n) => n.slug === slug);
  if (node === undefined) throw new Error(`nodeName: unknown taxonomy slug "${slug}"`);
  return node.name[lang];
}
