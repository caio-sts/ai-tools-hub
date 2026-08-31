import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { loadSkills } from '../src/lib/data.ts';
import { loadTaxonomy } from '../src/lib/taxonomy.ts';
import { buildRescueDocs, createRescueIndex, serializeRescueIndex } from '../src/lib/rescue.ts';
import type { Lang } from '../src/types.ts';

export const RESCUE_LANGS: readonly Lang[] = ['en', 'pt'];

/** Astro copies public/ verbatim, so the artifact needs no build-order relationship. */
export const RESCUE_OUT_DIR = 'public/rescue-index';

export function rescueIndexJson(lang: Lang): string {
  return serializeRescueIndex(createRescueIndex(buildRescueDocs(loadSkills(), loadTaxonomy(), lang)));
}

export function writeRescueIndexes(outDir: string = RESCUE_OUT_DIR): string[] {
  const dir = resolve(process.cwd(), outDir);
  mkdirSync(dir, { recursive: true });
  return RESCUE_LANGS.map((lang) => {
    const file = resolve(dir, `${lang}.json`);
    writeFileSync(file, `${rescueIndexJson(lang)}\n`, 'utf8');
    return file;
  });
}

if (argv[1] && argv[1].endsWith('build-rescue-index.ts')) {
  for (const file of writeRescueIndexes()) console.log(`wrote ${file}`);
}
