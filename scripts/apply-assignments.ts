import { pathToFileURL } from 'node:url';
import { loadAssignments, loadCollections, loadMeta, loadSkills } from '../src/lib/data.ts';
import { applyClassification, assignmentsByIdentity, writeCatalog, writeMeta } from './harvest/run.ts';
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
  const skills = applyClassification(loadSkills(dataDir), assignmentsByIdentity(loadAssignments(dataDir)));
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
