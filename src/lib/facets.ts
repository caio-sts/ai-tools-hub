// The catalog's shared derivations. Imported by the catalog's client script, so it must stay free
// of Node built-ins: no `node:fs`, and no import of src/lib/taxonomy.ts or src/lib/data.ts.
//
// The path constants live in ./base.ts and are re-exported here. That module has no imports at
// all, which is what lets vitest.config.ts read SITE_BASE without pulling in the i18n barrel and
// its import.meta.glob.
export { PAGEFIND_BASE_URL, PAGEFIND_BUNDLE_PATH, SITE_BASE } from './base.ts';

import type { Collection, Runtime, Safety, Skill } from '../types.ts';

export const INDEX_FILTER_KEYS = ['domain', 'subdomain', 'runtime', 'risk', 'license'] as const;
export type IndexFilterKey = (typeof INDEX_FILTER_KEYS)[number];

/** Rail order is decision frequency: "hide anything that executes code" comes first (§10.2). */
export const RAIL_FILTER_KEYS = ['risk', 'subdomain', 'runtime', 'license'] as const;
export type RailFilterKey = (typeof RAIL_FILTER_KEYS)[number];

export const RISK_VALUES = [
  'no-code-execution',
  'executes-code',
  'network',
  'reads-env',
  'declared-tools',
  'portable',
] as const;
export type RiskValue = (typeof RISK_VALUES)[number];

/** LED order (§10.3). Never sort runtimes alphabetically. */
export const RUNTIME_ORDER: readonly Runtime[] = ['claude', 'openclaw', 'codex', 'cursor', 'generic'];

export const LICENSE_UNSPECIFIED = 'unspecified';

export function collectionFor(repo: string, collections: Collection[]): Collection | null {
  return collections.find((c) => c.repo === repo) ?? null;
}

export function riskValues(safety: Safety, portable: boolean): RiskValue[] {
  const out: RiskValue[] = [];
  out.push(safety.executesCode ? 'executes-code' : 'no-code-execution');
  if (safety.network) out.push('network');
  if (safety.readsEnv) out.push('reads-env');
  if (safety.declaredTools && safety.declaredTools.length > 0) out.push('declared-tools');
  if (portable) out.push('portable');
  return out;
}

export function indexValues(skill: Skill): Record<IndexFilterKey, string[]> {
  const slugs = [skill.primary, ...skill.also].filter(Boolean);
  return {
    domain: [...new Set(slugs.map((s) => s.split('/')[0]))],
    subdomain: [...new Set(slugs)],
    runtime: [...new Set(skill.runtimes)],
    risk: riskValues(skill.safety, skill.portable),
    license: [skill.license ?? LICENSE_UNSPECIFIED],
  };
}

/**
 * §5.1: eviction by the per-subdomain cap sets `listed` false and leaves the row in
 * data/skills.json — it keeps being re-scored and it keeps its page (B4). Every catalog surface
 * is built from this filtered array, so an evicted entry disappears from the grid, the facet
 * counts and the search index at once, and returns whole if its score recovers.
 */
export function listedSkills(skills: Skill[]): Skill[] {
  return skills.filter((skill) => skill.listed);
}

export function countValues(skills: Skill[], key: IndexFilterKey): Map<string, number> {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    for (const value of indexValues(skill)[key]) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

export interface SortValues {
  score: string;
  stars: string;
  forks: string;
  newest: string;
  updated: string;
}

function pad(n: number, width: number): string {
  const safe = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  return String(safe).padStart(width, '0');
}

/** Pagefind sorts sort values as strings, so every numeric value is zero-padded to a fixed width. */
export function sortValues(skill: Skill, collection: Collection | null): SortValues {
  const iso = typeof skill.indexedAt === 'string' ? skill.indexedAt.slice(0, 10) : '';
  const newest = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.replace(/-/g, '') : '00000000';
  return {
    score: pad(skill.score, 3),
    stars: pad(collection?.stars ?? 0, 9),
    forks: pad(collection?.forks ?? 0, 9),
    newest,
    updated: pad(skill.updatedDays, 6),
  };
}

export interface PagefindPair {
  key: string;
  value: string;
}

export interface PagefindIndexAttrs {
  id: string;
  filters: PagefindPair[];
  sorts: PagefindPair[];
  text: string[];
}

/**
 * The attribute payload one skill page's Pagefind index block must carry. Kept here, beside
 * indexValues and sortValues, so the rail can never offer a value the index does not carry. B4's
 * per-skill route emits the block — and emits it only for a listed skill, since an evicted row
 * keeps its page but leaves the index (§5.1). This is the definition its built output is
 * asserted against.
 */
export function pagefindIndexAttrs(skill: Skill, collection: Collection | null): PagefindIndexAttrs {
  const values = indexValues(skill);
  const sorts = sortValues(skill, collection);
  const filters: PagefindPair[] = [];
  for (const key of INDEX_FILTER_KEYS) {
    for (const value of values[key]) filters.push({ key, value });
  }
  const text = [
    skill.name,
    skill.description,
    skill.descriptionPt ?? '',
    skill.longPt ?? '',
    skill.tags.join(' '),
    `${skill.repo} ${skill.path}`,
  ].filter((line) => line.trim().length > 0);
  return {
    id: skill.id,
    filters,
    sorts: [
      { key: 'score', value: sorts.score },
      { key: 'stars', value: sorts.stars },
      { key: 'forks', value: sorts.forks },
      { key: 'newest', value: sorts.newest },
      { key: 'updated', value: sorts.updated },
    ],
    text,
  };
}

export const SORT_KEYS = ['score', 'stars', 'forks', 'newest', 'updated'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const DEFAULT_SORT: SortKey = 'score';

/** 24 = four rows of the default 6-column grid (§10.2). */
export const PAGE_SIZE = 24;

export type FilterState = Partial<Record<IndexFilterKey, string[]>>;

export interface CatalogQuery {
  filters: FilterState;
  /** The catalog's own text term. Empty string means "browse", not "search for nothing". */
  q: string;
  sort: SortKey;
  page: number;
}

export interface ActiveChip {
  key: IndexFilterKey;
  value: string;
}

export function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

/** Values are joined with "," — safe because every filter value is a slug or an SPDX id. */
export function parseQuery(search: string): CatalogQuery {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const filters: FilterState = {};
  for (const key of INDEX_FILTER_KEYS) {
    const rawValue = params.get(key);
    if (!rawValue) continue;
    const values = rawValue.split(',').map((v) => v.trim()).filter(Boolean);
    if (values.length > 0) filters[key] = [...new Set(values)].sort();
  }
  const sortParam = params.get('sort') ?? '';
  const pageParam = Number.parseInt(params.get('page') ?? '1', 10);
  return {
    filters,
    q: (params.get('q') ?? '').trim(),
    sort: isSortKey(sortParam) ? sortParam : DEFAULT_SORT,
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
  };
}

export function serializeQuery(query: CatalogQuery): string {
  const parts: string[] = [];
  if (query.q.trim().length > 0) parts.push(`q=${encodeURIComponent(query.q.trim())}`);
  for (const key of INDEX_FILTER_KEYS) {
    const values = query.filters[key];
    if (!values || values.length === 0) continue;
    parts.push(`${key}=${[...values].sort().map(encodeURIComponent).join(',')}`);
  }
  if (query.sort !== DEFAULT_SORT) parts.push(`sort=${query.sort}`);
  if (query.page > 1) parts.push(`page=${query.page}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export function toggleFilter(filters: FilterState, key: IndexFilterKey, value: string): FilterState {
  const current = filters[key] ?? [];
  return current.includes(value)
    ? removeFilter(filters, key, value)
    : { ...filters, [key]: [...current, value].sort() };
}

export function removeFilter(filters: FilterState, key: IndexFilterKey, value: string): FilterState {
  const next: FilterState = { ...filters };
  const remaining = (next[key] ?? []).filter((v) => v !== value);
  if (remaining.length > 0) next[key] = remaining;
  else delete next[key];
  return next;
}

export function activeChips(filters: FilterState): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const key of INDEX_FILTER_KEYS) {
    for (const value of filters[key] ?? []) chips.push({ key, value });
  }
  return chips;
}

export type FacetCounts = Record<string, Record<string, number>>;

/** Drop one key's selection, so a search answers "what if this key were unselected". */
export function filtersWithout(active: FilterState, key: string): FilterState {
  const rest: Record<string, string[] | undefined> = { ...(active as Record<string, string[] | undefined>) };
  delete rest[key];
  return rest as FilterState;
}

/** A count map is unusable when it knows the key but reports nothing for any of its values. */
function hasRealCounts(counts: Record<string, number> | undefined): boolean {
  return counts !== undefined && Object.values(counts).some((n) => n > 0);
}

/**
 * Pagefind ORs within a key and ANDs across keys. `filters` is narrowed by the active selection, so
 * a sibling of an already-checked value reads its intersection with that selection, not what
 * checking it would add. `unfiltered` is the same key counted with its own selection dropped,
 * which is the question the rail asks.
 *
 * Pagefind supplies that as `totalFilters`, but only for a term search — on a null browse it comes
 * back present and entirely zero, which painted 0 beside every value of the active key, the checked
 * one included. So the controller computes it with one extra search per active key, and an
 * all-zero map is treated as absent: a key cannot honestly be all-zero while one of its own values
 * is selected, because that selection matched something. Falling back to the narrowed count shows
 * a smaller true number instead of a false one.
 */
export function facetCount(
  key: string,
  value: string,
  active: FilterState,
  filters: FacetCounts,
  unfiltered: FacetCounts,
): number {
  const keyIsActive = ((active as Record<string, string[] | undefined>)[key] ?? []).length > 0;
  const source = keyIsActive && hasRealCounts(unfiltered?.[key]) ? unfiltered : filters;
  return source?.[key]?.[value] ?? 0;
}

export interface PageView {
  page: number;
  totalPages: number;
  from: number;
  to: number;
  total: number;
}

export function pageView(total: number, page: number, pageSize: number = PAGE_SIZE): PageView {
  const size = Math.max(1, Math.floor(pageSize));
  const count = Math.max(0, Math.floor(total));
  const totalPages = Math.max(1, Math.ceil(count / size));
  const requested = Math.floor(page);
  const current = Math.min(Math.max(1, Number.isFinite(requested) ? requested : 1), totalPages);
  const from = (current - 1) * size;
  return { page: current, totalPages, from, to: Math.min(from + size, count), total: count };
}

export function pageNumbers(current: number, total: number): (number | 'gap')[] {
  if (total <= 0) return [];
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = new Set<number>([1, total]);
  for (let p = current - 1; p <= current + 1; p += 1) {
    if (p >= 1 && p <= total) wanted.add(p);
  }
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous !== 0 && page - previous > 1) out.push('gap');
    out.push(page);
    previous = page;
  }
  return out;
}

export interface SortableCard {
  id: string;
  score: number;
  stars: number;
  forks: number;
  newest: number;
  updated: number;
}

export function toSortableCard(skill: Skill, collection: Collection | null): SortableCard {
  const parsed = Date.parse(skill.indexedAt);
  return {
    id: skill.id,
    score: skill.score,
    stars: collection?.stars ?? 0,
    forks: collection?.forks ?? 0,
    newest: Number.isNaN(parsed) ? 0 : parsed,
    updated: skill.updatedDays,
  };
}

export function sortCards(cards: SortableCard[], sort: SortKey): SortableCard[] {
  const direction: Record<SortKey, 1 | -1> = { score: -1, stars: -1, forks: -1, newest: -1, updated: 1 };
  const field: Record<SortKey, keyof Omit<SortableCard, 'id'>> = {
    score: 'score', stars: 'stars', forks: 'forks', newest: 'newest', updated: 'updated',
  };
  const key = field[sort];
  const sign = direction[sort];
  return [...cards].sort((a, b) => {
    if (a[key] !== b[key]) return (a[key] - b[key]) * sign;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

import type { Lang, Taxonomy, TaxonomyNode } from '../types.ts';
import { t } from './i18n/index.ts';

export const FACET_LABEL_KEYS: Record<RailFilterKey, string> = {
  risk: 'catalog.facet.risk',
  subdomain: 'catalog.facet.subdomain',
  runtime: 'catalog.facet.runtime',
  license: 'catalog.facet.license',
};

export const RISK_LABEL_KEYS: Record<RiskValue, string> = {
  'no-code-execution': 'catalog.risk.noCodeExecution',
  'executes-code': 'catalog.risk.executesCode',
  network: 'catalog.risk.network',
  'reads-env': 'catalog.risk.readsEnv',
  'declared-tools': 'catalog.risk.declaredTools',
  portable: 'catalog.risk.portable',
};

export const RUNTIME_LABEL_KEYS: Record<Runtime, string> = {
  claude: 'catalog.runtime.claude',
  openclaw: 'catalog.runtime.openclaw',
  codex: 'catalog.runtime.codex',
  cursor: 'catalog.runtime.cursor',
  generic: 'catalog.runtime.generic',
};

export const SORT_LABEL_KEYS: Record<SortKey, string> = {
  score: 'catalog.sort.score',
  stars: 'catalog.sort.stars',
  forks: 'catalog.sort.forks',
  newest: 'catalog.sort.newest',
  updated: 'catalog.sort.updated',
};

export function sortLabel(key: SortKey, lang: Lang): string {
  return t(SORT_LABEL_KEYS[key], lang);
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
  /** Domain heading the UI nests this option under. The index stays flat. */
  group: string | null;
}

export interface FacetGroup {
  key: RailFilterKey;
  label: string;
  hint: string;
  options: FacetOption[];
}

function nameOf(node: TaxonomyNode, lang: Lang): string {
  return node.name[lang];
}

function subdomainOptions(skills: Skill[], taxonomy: Taxonomy, lang: Lang): FacetOption[] {
  const counts = countValues(skills, 'subdomain');
  const options: FacetOption[] = [];
  for (const domain of taxonomy.domains) {
    for (const child of domain.children ?? []) {
      const count = counts.get(child.slug) ?? 0;
      if (count === 0) continue;
      options.push({ value: child.slug, label: nameOf(child, lang), count, group: nameOf(domain, lang) });
    }
  }
  return options;
}

function licenseOptions(skills: Skill[], lang: Lang): FacetOption[] {
  const counts = countValues(skills, 'license');
  const named = [...counts.entries()]
    .filter(([value]) => value !== LICENSE_UNSPECIFIED)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, label: value, count, group: null }));
  const undeclared = counts.get(LICENSE_UNSPECIFIED) ?? 0;
  if (undeclared > 0) {
    named.push({
      value: LICENSE_UNSPECIFIED,
      label: t('catalog.license.unspecified', lang),
      count: undeclared,
      group: null,
    });
  }
  return named;
}

export function buildFacetGroups(skills: Skill[], taxonomy: Taxonomy, lang: Lang): FacetGroup[] {
  // A count is a promise about what checking the box returns, and an evicted entry is absent from
  // the Pagefind index (§5.1) — so it contributes to nothing here, whatever the caller passed.
  const listed = listedSkills(skills);
  const riskCounts = countValues(listed, 'risk');
  const runtimeCounts = countValues(listed, 'runtime');
  const hint = t('catalog.anyOf', lang);
  return [
    {
      key: 'risk',
      label: t(FACET_LABEL_KEYS.risk, lang),
      hint,
      options: RISK_VALUES.map((value) => ({
        value,
        label: t(RISK_LABEL_KEYS[value], lang),
        count: riskCounts.get(value) ?? 0,
        group: null,
      })),
    },
    { key: 'subdomain', label: t(FACET_LABEL_KEYS.subdomain, lang), hint, options: subdomainOptions(listed, taxonomy, lang) },
    {
      key: 'runtime',
      label: t(FACET_LABEL_KEYS.runtime, lang),
      hint,
      options: RUNTIME_ORDER.map((value) => ({
        value,
        label: t(RUNTIME_LABEL_KEYS[value], lang),
        count: runtimeCounts.get(value) ?? 0,
        group: null,
      })),
    },
    { key: 'license', label: t(FACET_LABEL_KEYS.license, lang), hint, options: licenseOptions(listed, lang) },
  ];
}

/**
 * Value -> label for every key the reader can filter on, serialized into the page so the client
 * script can label a chip without importing an i18n table or the fs-backed taxonomy loader.
 */
export function chipLabelMap(
  groups: FacetGroup[],
  taxonomy: Taxonomy,
  lang: Lang,
): Record<string, Record<string, string>> {
  const map: Record<string, Record<string, string>> = { domain: {} };
  for (const domain of taxonomy.domains) map.domain[domain.slug] = nameOf(domain, lang);
  for (const group of groups) {
    map[group.key] = Object.fromEntries(group.options.map((o) => [o.value, o.label]));
  }
  return map;
}
