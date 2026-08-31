import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import { t } from '../../src/lib/i18n/index.ts';
import { countBySlug, loadTaxonomy, nodeName } from '../../src/lib/taxonomy.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function built(page: string): string {
  const file = `${ROOT}dist/${page}`;
  if (!existsSync(file)) {
    throw new Error(`dist/${page} was not built — read the globalSetup "astro build" output`);
  }
  return readFileSync(file, 'utf8');
}

interface RenderedNode {
  slug: string;
  state: string;
  count: number;
  html: string;
}

function grid(html: string, key: string): string {
  const open = html.indexOf(`data-grid="${key}"`);
  if (open === -1) throw new Error(`the built page has no <ul data-grid="${key}"> grid`);
  const close = html.indexOf('</ul>', open);
  return html.slice(open, close);
}

function nodes(html: string, key: string): RenderedNode[] {
  const section = grid(html, key);
  const out: RenderedNode[] = [];
  for (const match of section.matchAll(/<li[^>]*data-slug="([^"]+)"[^>]*>/g)) {
    const start = match.index ?? 0;
    const stop = section.indexOf('</li>', start);
    out.push({
      slug: match[1],
      state: /data-state="([a-z]+)"/.exec(match[0])?.[1] ?? '',
      count: Number(/data-count="(\d+)"/.exec(match[0])?.[1] ?? Number.NaN),
      html: section.slice(start, stop + 5).replace(/\s+/g, ' '),
    });
  }
  return out;
}

/** Astro escapes `&` in a text expression; accept either the numeric or the named form. */
function showsLabel(html: string, label: string): boolean {
  return [label, label.replace(/&/g, '&#38;'), label.replace(/&/g, '&amp;')].some((form) =>
    html.includes(form),
  );
}

const en = built('en/index.html');
const pt = built('pt/index.html');
const taxonomy = loadTaxonomy();
const skills = loadSkills();
const counts = countBySlug(skills);
const securityChildren = taxonomy.domains.find((d) => d.slug === 'security')?.children ?? [];

describe('the expanded security grid', () => {
  it('renders every security subdomain the taxonomy declares, in taxonomy order', () => {
    expect(nodes(en, 'security').map((node) => node.slug)).toEqual(
      securityChildren.map((child) => child.slug),
    );
  });

  it('counts primary and also placements, exactly as countBySlug does', () => {
    for (const node of nodes(en, 'security')) {
      expect(node.count, `${node.slug} count`).toBe(counts.get(node.slug) ?? 0);
    }
  });

  it('counts only listed entries, so an evicted one cannot prop a node above minimum mass', () => {
    const listedCounts = new Map<string, number>();
    for (const skill of skills) {
      if (!skill.listed) continue;
      for (const slug of new Set<string>([skill.primary, ...skill.also])) {
        listedCounts.set(slug, (listedCounts.get(slug) ?? 0) + 1);
      }
    }
    for (const node of nodes(en, 'security')) {
      expect(node.count, `${node.slug} counts an entry the cap evicted`).toBe(
        listedCounts.get(node.slug) ?? 0,
      );
    }
  });

  it('puts every node in the one state its count earns', () => {
    const mass = taxonomy.minimumMass;
    for (const node of nodes(en, 'security')) {
      const expected = node.count === 0 ? 'empty' : node.count < mass ? 'thin' : 'active';
      expect(node.state, `${node.slug} holds ${node.count} of ${mass}`).toBe(expected);
    }
  });

  it('makes an active node a real link into the pre-filtered catalog', () => {
    for (const node of nodes(en, 'security').filter((n) => n.state === 'active')) {
      const href = `/ai-tools-hub/en/catalog/?subdomain=${encodeURIComponent(node.slug)}`;
      expect(node.html.includes(`href="${href}"`), `${node.slug} does not link to ${href}`).toBe(
        true,
      );
      expect(node.html.includes(`>${node.count}<`), `${node.slug} hides its count`).toBe(true);
    }
  });

  it('renders no anchor at all on a node a visitor cannot use', () => {
    for (const node of nodes(en, 'security').filter((n) => n.state !== 'active')) {
      expect(
        node.html.includes('<a'),
        `${node.slug} is ${node.state} but still renders an anchor`,
      ).toBe(false);
    }
  });

  it('tells a thin node how far it is from the threshold, and why it is not navigable', () => {
    for (const node of nodes(en, 'security').filter((n) => n.state === 'thin')) {
      const ratio = `${node.count} / ${taxonomy.minimumMass}`;
      expect(node.html.includes(ratio), `${node.slug} does not show "${ratio}"`).toBe(true);
      expect(
        node.html.includes(t('home.nodeThin', 'en')),
        `${node.slug} does not say why it is not navigable`,
      ).toBe(true);
    }
  });

  it('renders an absence as an em-dash rather than a zero', () => {
    for (const node of nodes(en, 'security').filter((n) => n.state === 'empty')) {
      expect(node.html.includes('—'), `${node.slug} renders no em-dash`).toBe(true);
      expect(
        node.html.includes('aria-hidden="true"'),
        `${node.slug} reads its em-dash out to screen readers`,
      ).toBe(true);
      expect(
        node.html.includes(t('home.nodeEmpty', 'en')),
        `${node.slug} does not say it is empty`,
      ).toBe(true);
      expect(/>\s*0\s*</.test(node.html), `${node.slug} prints a zero`).toBe(false);
    }
  });

  it('labels every node from the taxonomy, in the page locale', () => {
    for (const node of nodes(en, 'security')) {
      expect(
        showsLabel(node.html, nodeName(node.slug, 'en')),
        `${node.slug} is not labelled in en`,
      ).toBe(true);
    }
    for (const node of nodes(pt, 'security')) {
      expect(
        showsLabel(node.html, nodeName(node.slug, 'pt')),
        `${node.slug} is not labelled in pt-BR`,
      ).toBe(true);
    }
  });

  it('keeps every catalog link inside the page locale', () => {
    for (const node of nodes(pt, 'security').filter((n) => n.state === 'active')) {
      expect(
        node.html.includes('/ai-tools-hub/pt/catalog/?subdomain='),
        `${node.slug} links out of the pt locale`,
      ).toBe(true);
    }
  });

  it('heads and anchors the section with the taxonomy own label for security', () => {
    expect(en.includes('id="taxonomy"'), 'no #taxonomy anchor on the home page').toBe(true);
    expect(en.includes(t('home.securityLead', 'en')), 'no en security lead').toBe(true);
    expect(showsLabel(pt, nodeName('security', 'pt')), 'no pt security heading').toBe(true);
    expect(pt.includes(t('home.securityLead', 'pt')), 'no pt security lead').toBe(true);
  });
});
