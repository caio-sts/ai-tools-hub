import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Removes /* … *\/ blocks so comment text never satisfies a token assertion. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Recursively lists files under `dir` whose name ends with `ext`, sorted. */
export function collectFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full, ext));
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out.sort();
}

/**
 * Every byte of CSS a browser would receive from a build output directory:
 * linked stylesheets plus inline <style> blocks Astro chose to inline.
 * Read-only — building dist/ is the suite's globalSetup's job, never a test's.
 */
export function readBuiltCss(root: string): string {
  const linked = collectFiles(root, '.css').map((file) => readFileSync(file, 'utf8'));
  const inline: string[] = [];
  for (const file of collectFiles(root, '.html')) {
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) inline.push(match[1]);
  }
  return stripCssComments([...linked, ...inline].join('\n'));
}

/** Splits CSS into the text inside @media blocks and the text outside them. */
export function splitMediaRegions(css: string): { outside: string; inside: string } {
  let outside = '';
  let inside = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at === -1) {
      outside += css.slice(i);
      break;
    }
    outside += css.slice(i, at);
    const open = css.indexOf('{', at);
    if (open === -1) {
      outside += css.slice(at);
      break;
    }
    let depth = 1;
    let k = open + 1;
    while (k < css.length && depth > 0) {
      const ch = css[k];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      k += 1;
    }
    inside += css.slice(open + 1, depth === 0 ? k - 1 : k);
    i = k;
  }
  return { outside, inside };
}

/** Names of custom properties DECLARED in the given CSS (var() uses are ignored). */
export function collectCustomProps(css: string): Set<string> {
  const found = new Set<string>();
  for (const match of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) found.add(match[1]);
  return found;
}

/** shadcn's exact colour alias names (§9.1). --radius is excluded: it is not a colour. */
export const SEMANTIC_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
] as const;
