import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Assignment, Collection, Meta, RawSkill, Safety, Skill, TreeFile } from '../../src/types.ts';
import { scoreSkill } from '../../src/lib/score.ts';
import { isPortable } from '../../src/lib/safety.ts';
import { resolveLicense } from '../../src/lib/license.ts';
import { detectRuntimes } from './enrich.ts';
import { fetchRawFile, type EnumerateDeps } from './enumerate.ts';

/** Primary key for a skill: skills have no version and no namespace primitive (spec §4.1). */
export function skillId(repo: string, sha: string, path: string): string {
  return `${repo}@${sha}:${path}`;
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

export interface BuildSkillInput {
  raw: RawSkill;
  collection: Collection;
  safety: Safety;
  /** Every blob path in the repo tree — resolveLicense needs it to spot a sibling LICENSE. */
  treePaths: string[];
  siblingLicenseText: string | null;
  assignment: Assignment | undefined;
  indexedAt: string;
}

export function buildSkill(input: BuildSkillInput): Skill {
  const { raw, collection, safety, treePaths, siblingLicenseText, assignment, indexedAt } = input;
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
    descriptionPt: null,
    longPt: null,
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
    primary: assignment?.primary ?? UNCLASSIFIED_PRIMARY,
    also: (assignment?.also ?? []).slice(0, MAX_ALSO),
    tags: (assignment?.tags ?? []).slice(0, MAX_TAGS),
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
 * Fetch the given files at one ref. The caller passes the repository head COMMIT sha: the tree
 * these paths came from was read at HEAD (A4.12), so HEAD is the ref at which all of them resolve.
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
    } catch {
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

  return { crawl, skipped };
}

export function carryForward(previous: CatalogSnapshot, skipped: Collection[]): Skill[] {
  const repos = new Set(skipped.map((collection) => collection.repo));
  return previous.skills.filter((skill) => repos.has(skill.repo));
}
