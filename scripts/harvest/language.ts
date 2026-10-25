import { eld } from 'eld/large';

/** Less prose than this is too little to judge; the skill is dropped (spec 2026-10-24 D1). */
export const MIN_PROSE_CHARS = 100;

/** Above this share of non-Latin words the instructions are not English or Portuguese. */
export const MAX_NON_LATIN_WORD_SHARE = 0.3;

const SUPPORTED = new Set(['en', 'pt']);
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/** Natural-language text of a SKILL.md: code, URLs, HTML and Markdown markup removed. */
export function proseOf(name: unknown, description: unknown, body: string): string {
  return [name, description, body]
    .filter((part): part is string => typeof part === 'string')
    .join('\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_|~\-[\]()!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nonLatinLetterShare(text: string): number {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return letters === 0 ? 0 : (letters - latin) / letters;
}

/** Two CJK characters count as one word, so dense scripts are not undercounted. */
function nonLatinWordShare(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}+/gu)?.length ?? 0;
  const other = text.replace(CJK, ' ').replace(/\p{Script=Latin}/gu, ' ').match(/\p{L}+/gu)?.length ?? 0;
  const foreign = cjk / 2 + other;
  return foreign + latin === 0 ? 0 : foreign / (foreign + latin);
}

/**
 * English or Portuguese, card and instructions both (spec 2026-10-24 D1). eld answers "ja" for an
 * English text with one Japanese phrase, so scripts are counted first and eld sees Latin text only.
 */
export function isSupportedLanguage(name: unknown, description: unknown, body: string): boolean {
  const prose = proseOf(name, description, body);
  if (prose.length < MIN_PROSE_CHARS) return false;
  if (typeof description === 'string' && nonLatinLetterShare(description) > 0.5) return false;
  if (nonLatinWordShare(prose) > MAX_NON_LATIN_WORD_SHARE) return false;
  const latinText = prose.replace(/[^\p{Script=Latin}\p{M}\s\d.,;:'"?]/gu, ' ');
  return SUPPORTED.has(eld.detect(latinText).language);
}
