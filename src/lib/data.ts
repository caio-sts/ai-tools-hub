import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Assignments, Collection, Meta, Skill } from '../types.ts';

/** No crawl has ever run. Honest and maximally stale, so the banner tells the truth. */
export const NEVER_CRAWLED = '1970-01-01T00:00:00.000Z';

export const EMPTY_META: Meta = {
  crawledAt: NEVER_CRAWLED,
  classifiedAt: null,
  skillCount: 0,
  sourceCount: 0,
};

export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));

function readJson(dataDir: string, file: string): unknown {
  try {
    return JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function loadSkills(dataDir: string = DEFAULT_DATA_DIR): Skill[] {
  const parsed = readJson(dataDir, 'skills.json');
  return Array.isArray(parsed) ? (parsed as Skill[]) : [];
}

export function loadCollections(dataDir: string = DEFAULT_DATA_DIR): Collection[] {
  const parsed = readJson(dataDir, 'collections.json');
  return Array.isArray(parsed) ? (parsed as Collection[]) : [];
}

export function loadMeta(dataDir: string = DEFAULT_DATA_DIR): Meta {
  const parsed = readJson(dataDir, 'meta.json') as Partial<Meta> | null;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...EMPTY_META };
  return {
    crawledAt: typeof parsed.crawledAt === 'string' ? parsed.crawledAt : NEVER_CRAWLED,
    classifiedAt: typeof parsed.classifiedAt === 'string' ? parsed.classifiedAt : null,
    skillCount: typeof parsed.skillCount === 'number' ? parsed.skillCount : 0,
    sourceCount: typeof parsed.sourceCount === 'number' ? parsed.sourceCount : 0,
  };
}

export function loadAssignments(dataDir: string = DEFAULT_DATA_DIR): Assignments {
  const parsed = readJson(dataDir, 'assignments.json');
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const out: Assignments = {};
  for (const [id, row] of Object.entries(parsed as Record<string, unknown>)) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    if (typeof record['primary'] !== 'string' || record['primary'] === '') continue;
    out[id] = {
      primary: record['primary'],
      also: stringList(record['also']),
      tags: stringList(record['tags']),
    };
  }
  return out;
}
