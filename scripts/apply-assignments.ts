import { pathToFileURL } from 'node:url';
import { loadAssignments, loadCollections, loadSkills } from '../src/lib/data.ts';
import { applyClassification, assignmentsByIdentity, rewriteCatalog } from './harvest/run.ts';
import { UNCLASSIFIED_PRIMARY } from './harvest/run.ts';

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
  const skills = await rewriteCatalog(dataDir, stored, classified, loadCollections(dataDir), { classifiedAt });
  const unclassified = skills.filter((skill) => skill.primary === UNCLASSIFIED_PRIMARY).length;

  return { classified: skills.length - unclassified, unclassified };
}

async function main(): Promise<void> {
  const dataDir = process.argv[2] ?? 'data';
  const { classified, unclassified } = await applyAssignmentsToCatalog(dataDir, new Date().toISOString());
  console.log(`classified ${classified}, still queued unclassified ${unclassified}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
