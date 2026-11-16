import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Lang, Skill, Taxonomy, TaxonomyNode } from '../types.ts';

/**
 * The committed taxonomy, wherever this module is running from. The import.meta.url-relative
 * path is correct under vitest and under `node scripts/*.ts`, but NOT under `astro build`:
 * Astro bundles this module into dist/.prerender/chunks/, so the relative walk would land on
 * dist/data/taxonomy.json. The cwd candidate covers that, and every entry point (vitest, astro
 * build, the harvest CLI, the systemd unit's WorkingDirectory) runs from the repo root.
 */
function resolveTaxonomyPath(): string {
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), '../../data/taxonomy.json'),
    resolve(process.cwd(), 'data/taxonomy.json'),
  ];
  return candidates.find((path) => existsSync(path)) ?? candidates[candidates.length - 1];
}

let cached: Taxonomy | null = null;

export function loadTaxonomy(): Taxonomy {
  if (cached === null) {
    cached = JSON.parse(readFileSync(resolveTaxonomyPath(), 'utf8')) as Taxonomy;
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

/**
 * `tax` reduced to its Active nodes, counted as the home grid counts them (spec §10.1). An alias of
 * a pruned leaf falls back to its domain, so `k8s` still rescues while its leaf is thin.
 */
export function activeTaxonomy(tax: Taxonomy, skills: Skill[]): Taxonomy {
  const counts = countBySlug(skills);
  const isActive = (count: number): boolean => nodeState(count, tax.minimumMass) === 'active';
  const domains = tax.domains
    .filter((domain) => isActive(countDomain(skills, domain.slug)))
    .map((domain) => domain.children === undefined ? domain : {
      ...domain,
      children: domain.children.filter((child) => isActive(counts.get(child.slug) ?? 0)),
    });
  const kept = new Set(flattenTaxonomy({ ...tax, domains }).map((node) => node.slug));
  const aliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(tax.aliases)) {
    const node = flattenTaxonomy(tax).find((n) => n.slug === target || n.slug.endsWith(`/${target}`));
    if (node === undefined) continue;
    const domain = node.slug.split('/')[0]!;
    if (kept.has(node.slug)) aliases[alias] = target;
    else if (kept.has(domain)) aliases[alias] = domain;
  }
  return { ...tax, domains, aliases };
}
