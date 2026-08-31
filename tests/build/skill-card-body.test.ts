import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { officialFileUrl, rawFileUrl } from '../../src/lib/slug.ts';
import { ROOT, bundles, cardOf, elementWith, pageFor, panelOf, tagWith, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const JS = bundles().map((bundle) => bundle.js).join('\n');
const SOURCE = readFileSync(join(ROOT, 'src/components/SkillCard.astro'), 'utf8');

describe('the full body', () => {
  it('points the panel at raw.githubusercontent.com at the indexed commit', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      expect(tagWith(panel, 'data-field="body"')).toContain(`data-body-url="${rawFileUrl(skill)}"`);
    }
  });

  it('ships the indexed description as the no-JavaScript fallback', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      // Normalise whitespace only. text() strips <…> as tags, which would silently delete a
      // literal angle-bracket placeholder from the EXPECTED side while the rendered side keeps
      // it (Astro escapes it, and text() decodes the entities back).
      const indexed = skill.description.replace(/\s+/g, ' ').trim();
      expect(text(elementWith(panel, 'data-field="body"'))).toContain(indexed);
    }
  });

  it('renders a translated body server-side, labelled, with the original one click away', () => {
    for (const skill of SKILLS.filter((s) => s.longPt)) {
      const panel = panelOf(cardOf(pageFor('pt', skill)));
      const body = elementWith(panel, 'data-field="body"');
      expect(text(body)).toContain(text(skill.longPt!));
      expect(text(body)).toContain(strings.pt['skill.machineTranslated']);
      expect(body).toContain(`href="${officialFileUrl(skill)}"`);
    }
  });

  it('never fetches a body it has already translated', () => {
    for (const skill of SKILLS.filter((s) => s.longPt)) {
      const panel = panelOf(cardOf(pageFor('pt', skill)));
      expect(tagWith(panel, 'data-field="body"')).not.toContain('data-body-url');
    }
  });

  it('carries a localised failure message rather than failing silently', () => {
    for (const lang of ['en', 'pt'] as const) {
      const panel = panelOf(cardOf(pageFor(lang, SKILLS[0])));
      expect(tagWith(panel, 'data-field="body"'))
        .toContain(`data-body-error="${strings[lang]['skill.bodyUnavailable']}"`);
    }
  });

  it('ships the fetch handler and loads cards that arrive already open', () => {
    expect(JS).toContain('data-body-url');
    expect(JS).toContain('fetch(');
    expect(JS).toContain('.skill-card[open]');
  });

  it('renders the fetched document as text, never as HTML', () => {
    expect(SOURCE).toContain('textContent');
    expect(SOURCE).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
