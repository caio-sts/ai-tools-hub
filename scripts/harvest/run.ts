import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type {
  Assignment,
  Assignments,
  Collection,
  Meta,
  RawSkill,
  RepoRef,
  Safety,
  ScoreBreakdown,
  Skill,
  TreeFile,
} from '../../src/types.ts';
import { loadAssignments, loadCollections, loadMeta, loadSkills } from '../../src/lib/data.ts';
import { resolveLicense, siblingLicensePath } from '../../src/lib/license.ts';
import { EVICT_RANK, applyListing, compareForRank } from '../../src/lib/rank.ts';
import { deriveSafety, isPortable, scriptFilesFor } from '../../src/lib/safety.ts';
import { scoreSkill } from '../../src/lib/score.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import {
  RateLimitedError,
  createBudget,
  timeBudgetFromEnv,
  type Budget,
  type BudgetLimits,
  type StopReason,
} from './budget.ts';
import { discoverRepos } from './discover.ts';
import { enumerateSkills, fetchRawFile, fetchTree, type EnumerateDeps, type RepoSnapshot } from './enumerate.ts';
import { detectRuntimes, enrichCollections, type EnrichResult } from './enrich.ts';

/** Primary key for a skill: skills have no version and no namespace primitive (spec §4.1). */
export function skillId(repo: string, sha: string, path: string): string {
  return `${repo}@${sha}:${path}`;
}

/** The inverse of skillId. Returns null for anything that is not one. */
export function parseSkillId(id: string): { repo: string; sha: string; path: string } | null {
  const at = id.indexOf('@');
  if (at <= 0) return null;
  const colon = id.indexOf(':', at + 1);
  if (colon === -1) return null;

  const repo = id.slice(0, at);
  const sha = id.slice(at + 1, colon);
  const path = id.slice(colon + 1);
  return sha === '' || path === '' ? null : { repo, sha, path };
}

/**
 * A skill's identity across crawls. skillId embeds the commit the content was read at, so a
 * re-crawl of an active repository renames every entry; repo + path is what survives, and is
 * what the classification runbook says a decision carries forward on.
 */
export function identityKey(repo: string, path: string): string {
  return `${repo}\u0000${path}`;
}

/** data/assignments.json rekeyed off the sha, so a decision outlives the crawl that indexed it. */
export function assignmentsByIdentity(assignments: Assignments): Map<string, Assignment> {
  const index = new Map<string, Assignment>();
  for (const [id, assignment] of Object.entries(assignments)) {
    const parsed = parseSkillId(id);
    if (parsed !== null) index.set(identityKey(parsed.repo, parsed.path), assignment);
  }
  return index;
}

const SECURITY_PATTERNS: RegExp[] = [
  /\b(security|secure|vulnerabilit(y|ies)|cve|exploit|malware|hardening)\b/i,
  /\b(sast|dast|sbom|slsa|owasp|iam|rbac|oauth|oidc|siem|mfa|sso|cspm|ciem)\b/i,
  /\b(secret|secrets|credential|credentials|vault|rotation)\b/i,
  /\b(threat model|threat modeling|attack surface|penetration test|pentest|red team)\b/i,
  /\b(supply chain|least privilege|prompt injection|sql injection|xss|csrf)\b/i,
  /\b(compliance|soc\s?2|hipaa|pci[- ]dss|gdpr|iso\s?27001|audit)\b/i,
  /\b(forensic|forensics|incident response|encryption|cryptograph(y|ic))\b/i,
];

/** Cross-cutting flag: true even when the primary domain is not `security` (spec §3.4). */
export function isSecurityRelevant(text: string): boolean {
  return SECURITY_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The frontmatter `compatibility` field as plain topic strings, so it can be appended to the
 * repo topics and handed to A5's single detectRuntimes(). There is no second runtime mapper.
 */
export function compatibilityTopics(frontmatter: Record<string, unknown>): string[] {
  const declared = frontmatter['compatibility'];
  const list: unknown[] = Array.isArray(declared) ? declared : typeof declared === 'string' ? [declared] : [];
  return list.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Where a skill sits until the classification PR lands. It is a real taxonomy node,
 * so referential integrity holds and nothing disappears (spec §13).
 */
export const UNCLASSIFIED_PRIMARY = 'vertical-domain/general';

const MAX_ALSO = 2;
const MAX_TAGS = 10;

/** The three assignment-owned fields, capped. The only writer of them, on both harvest paths. */
function classificationOf(assignment: Assignment | undefined): Pick<Skill, 'primary' | 'also' | 'tags'> {
  return {
    primary: assignment?.primary ?? UNCLASSIFIED_PRIMARY,
    also: (assignment?.also ?? []).slice(0, MAX_ALSO),
    tags: (assignment?.tags ?? []).slice(0, MAX_TAGS),
  };
}

/** What a previous crawl had translated, and the English it was a translation OF. */
export type TranslationCarry = Pick<Skill, 'description' | 'descriptionPt' | 'longPt'>;

/**
 * Harvest never translates, but it must not destroy what the translation PR wrote. Carry the
 * pt-BR text over only while the English it renders is byte-identical: a translation relabelled
 * onto rewritten source text would be silently wrong, which is the one failure mode this
 * catalog refuses (spec §13).
 */
function translationOf(
  previous: TranslationCarry | undefined,
  description: string,
): Pick<Skill, 'descriptionPt' | 'longPt'> {
  if (previous === undefined || previous.description !== description) return { descriptionPt: null, longPt: null };
  return { descriptionPt: previous.descriptionPt, longPt: previous.longPt };
}

export interface BuildSkillInput {
  raw: RawSkill;
  collection: Collection;
  safety: Safety;
  /** Every blob path in the repo tree — resolveLicense needs it to spot a sibling LICENSE. */
  treePaths: string[];
  siblingLicenseText: string | null;
  assignment: Assignment | undefined;
  /** The matching row from the previous crawl, so its pt-BR text is not dropped on re-crawl. */
  previousTranslation?: TranslationCarry | undefined;
  indexedAt: string;
}

export function buildSkill(input: BuildSkillInput): Skill {
  const { raw, collection, safety, treePaths, siblingLicenseText, assignment, previousTranslation, indexedAt } =
    input;
  const frontmatter = raw.frontmatter;

  const segments = raw.path.split('/');
  const declaredName = frontmatter['name'];
  const name =
    typeof declaredName === 'string' && declaredName.trim() !== ''
      ? declaredName.trim()
      : (segments.length >= 2 ? segments[segments.length - 2] : segments[0]) ?? raw.path;

  const declaredDescription = frontmatter['description'];
  const description = typeof declaredDescription === 'string' ? declaredDescription.trim() : '';

  const { license, licenseSource } = resolveLicense({
    frontmatter,
    skillPath: raw.path,
    treePaths,
    repoLicense: collection.license,
    siblingLicenseText,
  });

  const portable = isPortable(frontmatter);
  const runtimes = detectRuntimes([...collection.topics, ...compatibilityTopics(frontmatter)]);

  const breakdown = scoreSkill({
    stars: collection.stars,
    updatedDays: raw.updatedDays,
    curated: collection.curated,
    isOrg: collection.isOrg,
    license,
    portable,
    description,
  });

  return {
    id: skillId(raw.repo, raw.sha, raw.path),
    type: 'skill',
    name,
    description,
    // Harvest is deterministic and never translates. The translation PR fills these in.
    ...translationOf(previousTranslation, description),
    repo: raw.repo,
    path: raw.path,
    sha: raw.sha,
    updatedDays: raw.updatedDays,
    indexedAt,
    license,
    licenseSource,
    portable,
    runtimes,
    safety,
    ...classificationOf(assignment),
    securityRelevant: isSecurityRelevant(`${name} ${description}`),
    // Provisional. applyListing (A6.9) is the authority on this field and runHarvest applies
    // it over the whole catalog before writing, so the cap decides what is listed (spec §5.1).
    listed: true,
    score: breakdown.total,
    breakdown,
  };
}

/** Per-skill cap on raw content requests, so one 846-path monorepo cannot burn the core budget. */
export const MAX_SCRIPT_FILES = 25;

/**
 * Fetch the given files at one ref: the enrichment oid the repo is pinned to for this run, so
 * every file resolves at the same commit the tree was read at.
 */
export async function fetchScriptContents(
  repo: string,
  commitSha: string,
  files: TreeFile[],
  deps: EnumerateDeps = {},
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();

  for (const file of files.slice(0, MAX_SCRIPT_FILES)) {
    try {
      const text = await fetchRawFile(repo, commitSha, file.path, deps);
      if (text !== null) contents.set(file.path, text);
    } catch (error) {
      if (error instanceof RateLimitedError) throw error;
      // One unreadable script costs that script's network/env signal, never the whole crawl.
    }
  }

  return contents;
}

/** The two catalog arrays in memory. On disk they are two separate bare-array files. */
export interface CatalogSnapshot {
  skills: Skill[];
  collections: Collection[];
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeCatalog(dataDir: string, snapshot: CatalogSnapshot): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeJson(join(dataDir, 'skills.json'), snapshot.skills);
  await writeJson(join(dataDir, 'collections.json'), snapshot.collections);
}

export async function writeMeta(dataDir: string, meta: Meta): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeJson(join(dataDir, 'meta.json'), meta);
}

export function pushedAtIndex(previous: CatalogSnapshot): Map<string, string> {
  const index = new Map<string, string>();
  for (const collection of previous.collections) {
    index.set(collection.repo, collection.pushedAt);
  }
  return index;
}

/** The previous crawl's pt-BR text, keyed so a changed sha cannot lose it. */
export function translationIndex(skills: Skill[]): Map<string, TranslationCarry> {
  const index = new Map<string, TranslationCarry>();
  for (const skill of skills) {
    index.set(identityKey(skill.repo, skill.path), {
      description: skill.description,
      descriptionPt: skill.descriptionPt,
      longPt: skill.longPt,
    });
  }
  return index;
}

/** A repo whose pushedAt has not moved cannot have new or changed skills (spec §6.1). */
export function partitionRepos(
  fresh: Collection[],
  index: Map<string, string>,
): { crawl: Collection[]; skipped: Collection[] } {
  const crawl: Collection[] = [];
  const skipped: Collection[] = [];

  for (const collection of fresh) {
    const seen = index.get(collection.repo);
    if (seen !== undefined && seen === collection.pushedAt) {
      skipped.push(collection);
    } else {
      crawl.push(collection);
    }
  }

  // Never-read first (by stars), then changed repos whose stored data is oldest: the stored
  // pushedAt is the resume cursor (budgeted-crawl spec §3.3).
  const neverRead = crawl
    .filter((collection) => !index.has(collection.repo))
    .sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo));
  const changed = crawl
    .filter((collection) => index.has(collection.repo))
    .sort((a, b) => index.get(a.repo)!.localeCompare(index.get(b.repo)!) || a.repo.localeCompare(b.repo));

  return { crawl: [...neverRead, ...changed], skipped };
}

/**
 * Re-stamp the classification onto rows that were not rebuilt. Every field but the three the
 * assignment owns is left exactly as it was, so this is safe to run over a whole catalog.
 */
export function applyClassification(skills: Skill[], assignments: Map<string, Assignment>): Skill[] {
  return skills.map((skill) => ({
    ...skill,
    ...classificationOf(assignments.get(identityKey(skill.repo, skill.path))),
  }));
}

/**
 * The previous rows of the repos this run skipped. A skipped repo is not re-read, so buildSkill
 * never sees these entries — which is why the current classification is re-applied here too.
 * Otherwise a classification PR would land in data/assignments.json and never reach the site.
 */
export function carryForward(
  previous: CatalogSnapshot,
  skipped: Collection[],
  assignments: Map<string, Assignment>,
): Skill[] {
  const repos = new Set(skipped.map((collection) => collection.repo));
  return applyClassification(
    previous.skills.filter((skill) => repos.has(skill.repo)),
    assignments,
  );
}

export interface HarvestDeps {
  discoverRepos(token: string): Promise<RepoRef[]>;
  enrichCollections(repos: RepoRef[], token: string): Promise<EnrichResult>;
  fetchTree(repo: string, ref: string, token: string): Promise<TreeFile[]>;
  enumerateSkills(snapshot: RepoSnapshot, token: string): Promise<RawSkill[]>;
  fetchRawFile(repo: string, ref: string, path: string): Promise<string | null>;
  fetchScriptContents(repo: string, ref: string, files: TreeFile[]): Promise<Map<string, string>>;
  deriveSafety(files: TreeFile[], contents: Map<string, string>, frontmatter: Record<string, unknown>): Safety;
  now(): Date;
  log(message: string): void;
}

export interface HarvestOptions {
  token: string;
  dataDir: string;
  allowlist?: string[] | null;
  deps?: Partial<HarvestDeps>;
  limits?: Partial<BudgetLimits>;
  /** Injected by tests; otherwise built from `limits`. */
  budget?: Budget;
}

export interface HarvestSummary {
  read: number;
  unchanged: number;
  deferred: number;
  failed: number;
  stopped: StopReason | null;
}

export type StuckReason = StopReason | 'repo failures';

/** The run read nothing of a non-empty queue: the crawler is stuck, not idle. */
export class StuckCrawlError extends Error {
  readonly reason: StuckReason;

  constructor(reason: StuckReason, queued: number) {
    super(`harvest: stopped on ${reason} before reading any of ${queued} queued repos`);
    this.name = 'StuckCrawlError';
    this.reason = reason;
  }
}

function defaultDeps(budget: Budget): HarvestDeps {
  const log = (message: string): void => console.log(message);
  const core: EnumerateDeps = { log, onCoreResponse: (res) => budget.observeCore(res) };
  const onGraphqlRemaining = (remaining: number): void => budget.observeGraphql(remaining);
  return {
    discoverRepos: (token) => discoverRepos(token, { log }),
    enrichCollections: (repos, token) => enrichCollections(repos, token, { onGraphqlRemaining }),
    fetchTree: (repo, ref, token) => fetchTree(repo, token, core, ref),
    enumerateSkills: (snapshot, token) => enumerateSkills(snapshot, token, { ...core, onGraphqlRemaining }),
    fetchRawFile: (repo, ref, path) => fetchRawFile(repo, ref, path),
    fetchScriptContents: (repo, ref, files) => fetchScriptContents(repo, ref, files),
    deriveSafety,
    now: () => new Date(),
    log,
  };
}

interface ReadContext {
  deps: HarvestDeps;
  token: string;
  assignments: Map<string, Assignment>;
  translations: Map<string, TranslationCarry>;
  indexedAt: string;
}

/** One repo at its pinned oid. A throw means nothing of this repo is kept. */
async function readRepo(collection: Collection, oid: string | null, context: ReadContext): Promise<Skill[]> {
  if (oid === null) return [];
  const { deps, token } = context;
  const started = deps.now().getTime();

  const tree = await deps.fetchTree(collection.repo, oid, token);
  const raws = await deps.enumerateSkills({ repo: { repo: collection.repo, stars: collection.stars }, oid, tree }, token);
  const treePaths = tree.filter((file) => file.type === 'blob').map((file) => file.path);

  const built: Skill[] = [];
  for (const raw of raws) {
    const scriptFiles = scriptFilesFor(tree, raw.path);
    const contents = await deps.fetchScriptContents(collection.repo, oid, scriptFiles);
    const safety = deps.deriveSafety(scriptFiles, contents, raw.frontmatter);

    const licensePath = siblingLicensePath(raw.path, treePaths);
    const siblingLicenseText = licensePath === null ? null : await deps.fetchRawFile(collection.repo, oid, licensePath);

    built.push(
      buildSkill({
        raw,
        collection,
        safety,
        treePaths,
        siblingLicenseText,
        assignment: context.assignments.get(identityKey(raw.repo, raw.path)),
        previousTranslation: context.translations.get(identityKey(raw.repo, raw.path)),
        indexedAt: context.indexedAt,
      }),
    );
  }

  // Sizes the margin between the time budget and timeout-minutes (budgeted-crawl spec §3.4).
  const elapsedMs = deps.now().getTime() - started;
  if (elapsedMs >= 60_000) deps.log(`harvest: ${collection.repo} read in ${Math.round(elapsedMs / 1000)}s`);
  return built;
}

export async function runHarvest(
  options: HarvestOptions,
): Promise<{ skills: Skill[]; collections: Collection[]; meta: Meta; summary: HarvestSummary }> {
  const budget = options.budget ?? createBudget(options.limits);
  const deps: HarvestDeps = { ...defaultDeps(budget), ...(options.deps ?? {}) };
  const { token, dataDir } = options;
  const allowlist = options.allowlist ?? null;

  const repos: RepoRef[] =
    allowlist !== null && allowlist.length > 0
      ? allowlist.map((repo) => ({ repo, stars: 0 }))
      : await deps.discoverRepos(token);

  const { collections, headOids } = await deps.enrichCollections(repos, token);

  const previous: CatalogSnapshot = { skills: loadSkills(dataDir), collections: loadCollections(dataDir) };
  const previousMeta = loadMeta(dataDir);
  const assignments = assignmentsByIdentity(loadAssignments(dataDir));
  const translations = translationIndex(previous.skills);

  const { crawl, skipped } = partitionRepos(collections, pushedAtIndex(previous));
  const skills: Skill[] = carryForward(previous, skipped, assignments);
  const indexedAt = deps.now().toISOString();
  const context: ReadContext = { deps, token, assignments, translations, indexedAt };

  let stopped: StopReason | null = null;
  let read = 0;
  const failed: Collection[] = [];
  let next = 0;
  for (; next < crawl.length; next += 1) {
    stopped = budget.exhausted();
    if (stopped !== null) break;
    const collection = crawl[next]!;
    try {
      skills.push(...(await readRepo(collection, headOids.get(collection.repo) ?? null, context)));
      read += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RateLimitedError) {
        deps.log(`harvest: ${collection.repo} discarded: ${message}`);
        stopped = 'rate limited';
        break;
      }
      deps.log(`harvest: ${collection.repo} failed: ${message}`);
      failed.push(collection);
    }
  }

  const deferred = [...failed, ...crawl.slice(next)];
  // With no guard stop, a queue that read nothing ran to its end with every repo failing.
  if (read === 0 && crawl.length > 0) throw new StuckCrawlError(stopped ?? 'repo failures', crawl.length);

  // Budgeted-crawl spec §3.5: a changed repo not reached, or failed, keeps its previous row (old
  // pushedAt, so it stays queued) and skills; a never-read one is left out until a run reaches it.
  const previousRows = new Map(previous.collections.map((collection) => [collection.repo, collection]));
  const deferredRepos = new Set(deferred.map((collection) => collection.repo));
  const kept = deferred.flatMap((collection) => previousRows.get(collection.repo) ?? []);
  skills.push(...carryForward(previous, kept, assignments));
  const rows = collections.flatMap((collection) =>
    deferredRepos.has(collection.repo) ? (previousRows.get(collection.repo) ?? []) : [collection],
  );

  skills.sort(compareForRank);

  // Survival (spec §5.1). The cap decides what is LISTED, never what is stored: every row stays
  // in skills.json and keeps being re-scored. `previous` is what the last committed run listed,
  // which is what makes eviction hysteretic instead of a rank-60 knife edge. applyListing
  // preserves the order it was given, so the sort above survives.
  const previouslyListed = new Set(previous.skills.filter((entry) => entry.listed).map((entry) => entry.id));
  const listed = applyListing(skills, previouslyListed, loadTaxonomy().minimumMass);

  const meta: Meta = {
    crawledAt: indexedAt,
    // Harvest never classifies; the classification PR owns this field (spec §6.1).
    classifiedAt: previousMeta.classifiedAt,
    skillCount: listed.length,
    sourceCount: rows.length,
    discoveredCount: collections.length,
  };

  await writeCatalog(dataDir, { skills: listed, collections: rows });
  await writeMeta(dataDir, meta);

  const summary: HarvestSummary = {
    read,
    unchanged: skipped.length,
    deferred: deferred.length,
    failed: failed.length,
    stopped,
  };
  deps.log(
    `harvest: read ${summary.read}, unchanged ${summary.unchanged}, deferred ${summary.deferred}, failed ${summary.failed}, stopped: ${stopped ?? 'queue drained'}`,
  );
  return { skills: listed, collections: rows, meta, summary };
}

export function parseArgs(argv: string[]): { allowlist: string[] | null; dataDir: string } {
  let allowlist: string[] | null = null;
  let dataDir = 'data';

  for (const arg of argv) {
    if (arg.startsWith('--allowlist=')) {
      allowlist = arg
        .slice('--allowlist='.length)
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
    } else if (arg.startsWith('--data-dir=')) {
      dataDir = arg.slice('--data-dir='.length);
    }
  }

  return { allowlist, dataDir };
}

/** `deps` is a test seam; production passes none. */
export async function main(
  argv: string[],
  env: Record<string, string | undefined>,
  deps?: Partial<HarvestDeps>,
): Promise<number> {
  const token = env['CATALOG_PAT'] ?? '';
  if (token === '') {
    console.error(
      'CATALOG_PAT is unset or empty. A fine-grained PAT with public-repo read is mandatory: ' +
        'GITHUB_TOKEN is repo-scoped and cannot perform global search (spec §6.2).',
    );
    return 1;
  }

  const { allowlist, dataDir } = parseArgs(argv);
  const timeBudgetMs = timeBudgetFromEnv(env['HARVEST_TIME_BUDGET_MIN']);
  const { meta, summary } = await runHarvest({ token, dataDir, allowlist, deps, limits: { timeBudgetMs } });
  console.log(
    `harvest: ${meta.skillCount} skills from ${meta.sourceCount} of ${meta.discoveredCount} sources at ${meta.crawledAt}`,
  );
  // Written and committable, but a failed repo must still fail the job.
  return summary.failed > 0 ? 1 : 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2), process.env)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export interface CatalogProblem {
  id: string;
  problem: string;
}

const COMPONENT_CAPS: ReadonlyArray<readonly [keyof ScoreBreakdown, number]> = [
  ['adoption', 25],
  ['maintenance', 30],
  ['provenance', 25],
  ['completeness', 20],
];

/**
 * Every invariant the published catalog claims, checked against itself. Deliberately says nothing
 * about which repos exist or how many: upstream changing is normal, the pipeline lying is not.
 */
export function validateCatalog(skills: Skill[], collections: Collection[], meta: Meta): CatalogProblem[] {
  const problems: CatalogProblem[] = [];
  const add = (id: string, problem: string): void => {
    problems.push({ id, problem });
  };

  const seenIds = new Set<string>();
  const repos = new Set(collections.map((collection) => collection.repo));
  const listedPerPrimary = new Map<string, number>();

  for (const skill of skills) {
    if (seenIds.has(skill.id)) add(skill.id, 'duplicate id');
    seenIds.add(skill.id);

    if (skill.id !== skillId(skill.repo, skill.sha, skill.path)) add(skill.id, 'id is not repo@sha:path');
    if (!repos.has(skill.repo)) add(skill.id, 'repo has no collection row');

    const b = skill.breakdown;
    for (const [component, cap] of COMPONENT_CAPS) {
      const value = b[component];
      if (!Number.isFinite(value) || value < 0 || value > cap) add(skill.id, `${component} outside 0..${cap}`);
    }
    if (b.adoption + b.maintenance + b.provenance + b.completeness !== b.total) {
      add(skill.id, 'breakdown does not sum to total');
    }
    if (skill.score !== b.total) add(skill.id, 'score does not equal breakdown.total');

    if (skill.license !== null && skill.licenseSource === null) add(skill.id, 'license set but licenseSource is null');
    if (skill.license === null && skill.licenseSource !== null) add(skill.id, 'licenseSource set but license is null');

    if (skill.runtimes.length === 0) add(skill.id, 'no runtimes');
    if (skill.also.length > 2) add(skill.id, 'more than 2 also entries');
    if (skill.tags.length > 10) add(skill.id, 'more than 10 tags');

    if (typeof skill.listed !== 'boolean') add(skill.id, 'listed is not a boolean');
    else if (skill.listed) listedPerPrimary.set(skill.primary, (listedPerPrimary.get(skill.primary) ?? 0) + 1);

    const safety = skill.safety;
    if (
      typeof safety.executesCode !== 'boolean' ||
      typeof safety.scriptCount !== 'number' ||
      !Array.isArray(safety.languages) ||
      typeof safety.network !== 'boolean' ||
      typeof safety.readsEnv !== 'boolean' ||
      (safety.declaredTools !== null && !Array.isArray(safety.declaredTools))
    ) {
      add(skill.id, 'incomplete safety surface');
    }
  }

  // Hysteresis lets a listing run to rank 72, never past it, and the minimum-mass floor (5)
  // is far below that — so no subdomain can legitimately list more than EVICT_RANK entries.
  // Monotonicity is deliberately NOT asserted: rank 65 listed while rank 61 is not is correct.
  for (const [primary, count] of listedPerPrimary) {
    if (count > EVICT_RANK) add(primary, 'more listed entries than the subdomain cap allows');
  }

  // The stored order IS the display order for entries Pagefind cannot separate: it sorts one key
  // as a string, has no second one, and falls back to index order, which is the order of this file.
  for (let i = 1; i < skills.length; i += 1) {
    const previous = skills[i - 1]!;
    const current = skills[i]!;
    if (compareForRank(previous, current) > 0) add(current.id, 'not in ranking order');
  }

  if (meta.skillCount !== skills.length) add('meta', 'meta.skillCount does not match the catalog');
  if (meta.sourceCount !== collections.length) add('meta', 'meta.sourceCount does not match the catalog');
  if (meta.discoveredCount < meta.sourceCount) add('meta', 'meta.discoveredCount is below meta.sourceCount');

  const crawled = new Date(meta.crawledAt);
  if (Number.isNaN(crawled.getTime()) || crawled.toISOString() !== meta.crawledAt) {
    add('meta', 'meta.crawledAt is not an ISO timestamp');
  }

  return problems;
}
