import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Lang, Skill } from '../../src/types.ts';
import { skillSlug } from '../../src/lib/slug.ts';

export const ROOT = process.cwd();
export const DIST = join(ROOT, 'dist');

export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function distFiles(extension: string): string[] {
  return walk(DIST).filter((file) => file.endsWith(extension));
}

/** Every stylesheet the site ships: real .css files and inlined <style> blocks, with their source. */
export function sheets(): Array<{ from: string; css: string }> {
  const out: Array<{ from: string; css: string }> = [];
  for (const file of distFiles('.css')) {
    out.push({ from: relative(ROOT, file), css: readFileSync(file, 'utf8') });
  }
  for (const file of distFiles('.html')) {
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      out.push({ from: relative(ROOT, file), css: match[1] });
    }
  }
  return out;
}

export function allCss(): string {
  return sheets().map((sheet) => sheet.css).join('\n');
}

/** Every hoisted client bundle the site ships. */
export function bundles(): Array<{ from: string; js: string }> {
  return distFiles('.js').map((file) => ({ from: relative(ROOT, file), js: readFileSync(file, 'utf8') }));
}

export function pageFor(lang: Lang, skill: Skill): string {
  const file = join(DIST, lang, 'skills', ...skillSlug(skill).split('/'), 'index.html');
  if (!existsSync(file)) throw new Error(`no built page at ${relative(ROOT, file)}`);
  return readFileSync(file, 'utf8');
}

export function mainOf(html: string): string {
  const open = html.indexOf('<main');
  const close = html.indexOf('</main>', open);
  if (open === -1 || close === -1) throw new Error('no <main> element in the built page');
  return html.slice(open, close);
}

export function cardOf(html: string): string {
  const open = html.indexOf('<details');
  const close = html.indexOf('</details>', open);
  if (open === -1 || close === -1) throw new Error('no skill card in the built page');
  return html.slice(open, close + '</details>'.length);
}

export function summaryOf(card: string): string {
  const at = card.indexOf('</summary>');
  if (at === -1) throw new Error('the skill card has no <summary>');
  return card.slice(0, at);
}

export function panelOf(card: string): string {
  const at = card.indexOf('</summary>');
  if (at === -1) throw new Error('the skill card has no <summary>');
  return card.slice(at + '</summary>'.length);
}

/** The opening tag of the first element carrying `attribute`, e.g. 'data-signal="env"'. */
export function tagWith(html: string, attribute: string): string {
  const at = html.indexOf(attribute);
  if (at === -1) throw new Error(`no element with ${attribute} in the built card`);
  const open = html.lastIndexOf('<', at);
  const close = html.indexOf('>', at);
  if (open === -1 || close === -1) throw new Error(`malformed tag around ${attribute}`);
  return html.slice(open, close + 1);
}

/** The first element carrying `attribute`, opening tag through its matching close tag. */
export function elementWith(html: string, attribute: string): string {
  const tag = tagWith(html, attribute);
  const name = /^<([a-z0-9-]+)/i.exec(tag)?.[1];
  if (!name) throw new Error(`could not read a tag name from ${tag}`);
  const start = html.indexOf(tag);
  const opener = new RegExp(`<${name}[\\s>]`, 'gi');
  const closer = `</${name}>`;
  let depth = 0;
  let cursor = start;
  while (cursor < html.length) {
    opener.lastIndex = cursor;
    const next = opener.exec(html);
    const end = html.indexOf(closer, cursor);
    if (end === -1) throw new Error(`unclosed <${name}> around ${attribute}`);
    if (next && next.index < end) {
      depth += 1;
      cursor = next.index + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return html.slice(start, end + closer.length);
    cursor = end + closer.length;
  }
  throw new Error(`unclosed <${name}> around ${attribute}`);
}

/**
 * Class tokens of an opening tag, as a set. Never compare a whole class="…" string:
 * Astro rewrites markup around it and attribute order is not ours to promise.
 */
export function classesOf(tag: string): string[] {
  const match = /class="([^"]*)"/.exec(tag);
  return match ? match[1].split(/\s+/).filter(Boolean) : [];
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ',
};

/** Visible text of an HTML fragment, tags stripped and entities decoded. */
export function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name])
    .replace(/\s+/g, ' ')
    .trim();
}

export function occurrences(haystack: string, needle: string): number {
  return needle === '' ? 0 : haystack.split(needle).length - 1;
}

/** The corpus in the order the route ranks it: score descending, id as tie-break. */
export function ranked(skills: Skill[]): Skill[] {
  return [...skills].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
