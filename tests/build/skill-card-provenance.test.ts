import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { officialFileUrl } from '../../src/lib/slug.ts';
import { allCss, bundles, cardOf, elementWith, pageFor, panelOf, tagWith, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();

describe('provenance and install', () => {
  it('prints the full owner/repo@sha:path identifier with the sha unshortened', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      expect(text(elementWith(panel, 'data-field="provenance"'))).toBe(skill.id);
      expect(skill.id).toContain(skill.sha);
      expect(skill.sha).toHaveLength(40);
    }
  });

  it('links the official file at the exact indexed commit', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      expect(tagWith(panel, 'data-field="official"')).toContain(`href="${officialFileUrl(skill)}"`);
    }
  });

  it('opens the official file safely in a new tab', () => {
    const tag = tagWith(panelOf(cardOf(pageFor('en', SKILLS[0]))), 'data-field="official"');
    expect(tag).toContain('rel="noopener noreferrer"');
    expect(tag).toContain('target="_blank"');
  });

  it('offers a copyable install command scoped to the source repo', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      const command = `npx skills add ${skill.repo}`;
      expect(text(elementWith(panel, 'data-field="install"'))).toBe(command);
      expect(tagWith(panel, 'data-field="copy"')).toContain(`data-copy="${command}"`);
    }
  });

  it('gives the copy control a WCAG 2.5.8 hit area', () => {
    const css = allCss().replace(/\s+/g, '');
    expect(css).toContain('min-height:24px');
    expect(css).toContain('min-width:24px');
  });

  it('ships the clipboard handler', () => {
    const js = bundles().map((bundle) => bundle.js).join('\n');
    expect(js).toContain('data-copy');
    expect(js).toContain('clipboard');
  });

  it('translates the panel labels on the pt route', () => {
    const panel = panelOf(cardOf(pageFor('pt', SKILLS[0])));
    expect(text(panel)).toContain(strings.pt['skill.officialFile']);
    expect(text(elementWith(panel, 'data-field="copy"'))).toBe(strings.pt['skill.copy']);
  });
});
