import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import { t } from '../../src/lib/i18n/index.ts';
import { countDomain, loadTaxonomy, nodeName } from '../../src/lib/taxonomy.ts';

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

const en = built('en/index.html');
const pt = built('pt/index.html');
const taxonomy = loadTaxonomy();
const skills = loadSkills();
const others = taxonomy.domains.filter((domain) => domain.slug !== 'security');

describe('the other top-level domains', () => {
  it('renders every domain except security, once each, in taxonomy order', () => {
    const slugs = nodes(en, 'domains').map((node) => node.slug);
    expect(slugs).toEqual(others.map((domain) => domain.slug));
    expect(slugs).not.toContain('security');
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('counts everything filed anywhere beneath a domain, once per skill', () => {
    for (const node of nodes(en, 'domains')) {
      expect(node.count, `${node.slug} count`).toBe(countDomain(skills, node.slug));
    }
  });

  it('counts only listed entries, so an evicted one cannot prop a domain above minimum mass', () => {
    for (const node of nodes(en, 'domains')) {
      const listed = skills.filter(
        (skill) =>
          skill.listed &&
          [skill.primary, ...skill.also].some(
            (slug) => slug === node.slug || slug.startsWith(`${node.slug}/`),
          ),
      ).length;
      expect(node.count, `${node.slug} counts an entry the cap evicted`).toBe(listed);
    }
  });

  it('puts every domain in the one state its count earns', () => {
    const mass = taxonomy.minimumMass;
    for (const node of nodes(en, 'domains')) {
      const expected = node.count === 0 ? 'empty' : node.count < mass ? 'thin' : 'active';
      expect(node.state, `${node.slug} holds ${node.count} of ${mass}`).toBe(expected);
    }
  });

  it('filters the catalog by domain, never by subdomain, from this section', () => {
    expect(grid(en, 'domains').includes('?subdomain='), 'a domain node filters by subdomain').toBe(
      false,
    );
    for (const node of nodes(en, 'domains').filter((n) => n.state === 'active')) {
      const href = `/ai-tools-hub/en/catalog/?domain=${encodeURIComponent(node.slug)}`;
      expect(node.html.includes(`href="${href}"`), `${node.slug} does not link to ${href}`).toBe(
        true,
      );
    }
  });

  it('leaves a thin or empty domain unclickable, exactly like a subdomain', () => {
    for (const node of nodes(en, 'domains').filter((n) => n.state !== 'active')) {
      expect(
        node.html.includes('<a'),
        `${node.slug} is ${node.state} but still renders an anchor`,
      ).toBe(false);
    }
  });

  it('heads the section in both locales', () => {
    expect(en.includes(t('home.otherHeading', 'en')), 'no en heading').toBe(true);
    expect(en.includes(t('home.otherLead', 'en')), 'no en lead').toBe(true);
    expect(pt.includes(t('home.otherHeading', 'pt')), 'no pt heading').toBe(true);
    expect(pt.includes(t('home.otherLead', 'pt')), 'no pt lead').toBe(true);
  });

  it('labels each domain from the taxonomy on the pt route', () => {
    for (const node of nodes(pt, 'domains')) {
      expect(
        node.html.includes(nodeName(node.slug, 'pt')),
        `${node.slug} is not labelled in pt-BR`,
      ).toBe(true);
    }
  });
});
