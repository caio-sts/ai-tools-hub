import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BASE = '/ai-tools-hub/';
const DIST = resolve(process.cwd(), 'dist');
const ROOT_RELATIVE = /\s(?:href|src)="(\/[^"]*)"/g;

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (full.endsWith('.html')) out.push(full);
  }
  return out;
}

describe('base path', () => {
  it('emits no root-relative URL outside the base path', () => {
    if (!existsSync(DIST)) {
      throw new Error('dist/ was not emitted by the globalSetup astro build');
    }
    const files = htmlFiles(DIST);
    expect(files.length, 'the build emitted no HTML at all').toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(ROOT_RELATIVE)) {
        const url = match[1];
        if (url.startsWith('//')) continue;
        if (url.startsWith(BASE)) continue;
        offenders.push(`${file.slice(DIST.length + 1)} -> ${url}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
