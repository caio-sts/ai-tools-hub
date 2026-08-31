import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Lang, Skill, Taxonomy, TaxonomyNode } from '../types.ts';

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

/** The three honest states a taxonomy node can render in (spec §10.1). */
export type NodeState = 'active' | 'thin' | 'empty';

/**
 * Entries per taxonomy slug: `primary` plus every `also`, counted once per skill (spec §3.1).
 * Listed entries only: a row the per-subdomain cap evicted (§5.1) keeps its page and keeps being
 * re-scored, but counting it here would let it prop a node above minimum mass.
 */
export function countBySlug(skills: Skill[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    if (!skill.listed) continue;
    for (const slug of new Set<string>([skill.primary, ...skill.also])) {
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
  }
  return counts;
}

/** Entries anywhere under a top-level domain, counted once per skill; listed only (§5.1). */
export function countDomain(skills: Skill[], domainSlug: string): number {
  const prefix = `${domainSlug}/`;
  let total = 0;
  for (const skill of skills) {
    if (!skill.listed) continue;
    const slugs = [skill.primary, ...skill.also];
    if (slugs.some((slug) => slug === domainSlug || slug.startsWith(prefix))) total += 1;
  }
  return total;
}

/** Minimum mass is governance: below it a node is shown but is not navigable (spec §10.1). */
export function nodeState(count: number, minimumMass: number): NodeState {
  if (count <= 0) return 'empty';
  return count >= minimumMass ? 'active' : 'thin';
}
