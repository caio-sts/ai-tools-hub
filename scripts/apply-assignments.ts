import { pathToFileURL } from 'node:url';
import { loadAssignments, loadCollections, loadMeta, loadSkills } from '../src/lib/data.ts';
import { applyClassification, assignmentsByIdentity, writeCatalog, writeMeta } from './harvest/run.ts';
import { UNCLASSIFIED_PRIMARY } from './harvest/run.ts';
import { applyListing, compareForRank } from '../src/lib/rank.ts';
import { loadTaxonomy } from '../src/lib/taxonomy.ts';

export interface ApplyResult {
  classified: number;
  unclassified: number;
}

/**
 * The half of the classification session that does not need the network. Harvest applies
 * data/assignments.json as it builds each row, but it only runs with a token and only rebuilds
 * repos whose pushedAt moved — so a session that lands assignments between two crawls needs
 * this to reach the site. Idempotent: assignments.json stays the single source of truth.
 */
export async function applyAssignmentsToCatalog(dataDir: string, classifiedAt: string): Promise<ApplyResult> {
  const stored = loadSkills(dataDir);
  const classified = applyClassification(stored, assignmentsByIdentity(loadAssignments(dataDir)));

  // Listing is DERIVED from primary — applyListing groups by it and caps each subdomain — so
  // re-stamping the classification without recomputing it leaves the flags describing a grouping
  // that no longer exists. The first pass split one over-cap group into twenty leaves, none near
  // the cap, and 41 entries would have stayed evicted from the catalog, facets and search index.
  const previouslyListed = new Set(stored.filter((skill) => skill.listed).map((skill) => skill.id));
  // Same order the harvest writes, so the committed file is deterministic and its diffs are
  // reviewable. It does NOT decide what the browser shows for entries sharing a score AND a
  // freshness: measured in a browser, Pagefind's residual tie order is its own, not index order.
  const ranked = [...classified].sort(compareForRank);
  const skills = applyListing(ranked, previouslyListed, loadTaxonomy().minimumMass);
  const unclassified = skills.filter((skill) => skill.primary === UNCLASSIFIED_PRIMARY).length;

  await writeCatalog(dataDir, { skills, collections: loadCollections(dataDir) });
  // skillCount is the number of rows STORED, matching runHarvest: the per-subdomain cap sets
  // Skill.listed, it never removes a row (spec §5.1).
  await writeMeta(dataDir, { ...loadMeta(dataDir), classifiedAt, skillCount: skills.length });

  return { classified: skills.length - unclassified, unclassified };
}

async function main(): Promise<void> {
  const dataDir = process.argv[2] ?? 'data';
  const { classified, unclassified } = await applyAssignmentsToCatalog(dataDir, new Date().toISOString());
  console.log(`classified ${classified}, still queued unclassified ${unclassified}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
