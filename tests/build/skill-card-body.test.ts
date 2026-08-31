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

  // longPt is null across the committed catalog: the pt panel fetches the author's own body,
  // exactly as the en panel does, so the reader loses no content to the translation. The branch
  // is still spec'd (§8) for the day bodies are translated, so when there is no data to read
  // these two tests assert the component implements it rather than looping over nothing — a test
  // that silently checks an empty list is how this catalog shipped broken once already.
  const TRANSLATED = SKILLS.filter((s) => s.longPt);

  it('renders a translated body server-side, labelled, with the original one click away', () => {
    if (TRANSLATED.length === 0) {
      expect(SOURCE).toContain('skill.longPt');
      expect(SOURCE).toContain('skill-body--translated');
      expect(SOURCE).toContain('skill.machineTranslated');
      return;
    }

    for (const skill of TRANSLATED) {
      const panel = panelOf(cardOf(pageFor('pt', skill)));
      const body = elementWith(panel, 'data-field="body"');
      // Whitespace-normalise rather than text() on the expected side, for the reason above: a
      // translation keeps the original's <placeholder> markers, and text() would strip them here
      // while the rendered side decodes them back.
      expect(text(body)).toContain(skill.longPt!.replace(/\s+/g, ' ').trim());
      expect(text(body)).toContain(strings.pt['skill.machineTranslated']);
      expect(body).toContain(`href="${officialFileUrl(skill)}"`);
    }
  });

  it('never fetches a body it has already translated', () => {
    if (TRANSLATED.length === 0) {
      // The two arms are mutually exclusive in the component, which is the property under test.
      expect(SOURCE).toContain('data-body-url');
      expect(SOURCE.indexOf('skill-body--translated')).toBeLessThan(SOURCE.indexOf('data-body-url'));
      return;
    }

    for (const skill of TRANSLATED) {
      const panel = panelOf(cardOf(pageFor('pt', skill)));
      expect(tagWith(panel, 'data-field="body"')).not.toContain('data-body-url');
    }
  });

  // A translated card never fetches, so it has no failure message to carry — asserting one on
  // every pt card only held while nothing was translated. Both branches are asserted instead, so
  // this stays honest whichever state an entry is in.
  it('either translates the body or carries a localised failure message', () => {
    for (const lang of ['en', 'pt'] as const) {
      for (const skill of SKILLS) {
        const panel = panelOf(cardOf(pageFor(lang, skill)));
        const tag = tagWith(panel, 'data-field="body"');

        if (lang === 'pt' && skill.longPt !== null) {
          expect(tag).not.toContain('data-body-url');
          expect(text(panel)).toContain(strings.pt['skill.machineTranslated']);
        } else {
          expect(tag).toContain(`data-body-error="${strings[lang]['skill.bodyUnavailable']}"`);
        }
      }
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
