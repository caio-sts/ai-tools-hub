import { eld } from 'eld/large';

/** Less prose than this is too little to judge; the skill is dropped (spec 2026-10-24 D1). */
export const MIN_PROSE_CHARS = 100;

/** Above this share of non-Latin words the instructions are not English or Portuguese. */
export const MAX_NON_LATIN_WORD_SHARE = 0.3;

/** eld reads only the first 1,000 characters of its input, so longer text is judged in windows. */
const ELD_WINDOW = 1000;

const SUPPORTED = new Set(['en', 'pt']);
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

export type LanguageVerdict =
  | 'supported'
  | 'too-short'
  | 'description-script'
  | 'description-language'
  | 'body-script'
  | 'body-language';

/** Natural-language text of a SKILL.md: code, URLs, HTML and Markdown markup removed. */
export function proseOf(name: unknown, description: unknown, body: string): string {
  return [name, description, body]
    .filter((part): part is string => typeof part === 'string')
    .join('\n')
    // A closing fence repeats the opening one, so a ``` inside a ```` block does not close it.
    .replace(/^ {0,3}(`{3,})[^\n]*\n[\s\S]*?^ {0,3}\1`*[ \t]*$/gm, ' ')
    .replace(/^ {0,3}(~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1~*[ \t]*$/gm, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<https?:\/\/[^>\s]*>/g, ' ')
    .replace(/https?:\/\/[^\s<>()]+/g, ' ')
    .replace(/<\/?[A-Za-z][^<>\n]*>/g, ' ')
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

/** eld answers "ja" for English with one Japanese phrase, so it only ever sees Latin text. */
function latinOnly(text: string): string {
  return text.replace(/[^\p{Script=Latin}\p{M}\s\d.,;:'"?]/gu, ' ');
}

function supportedShare(text: string): number {
  let supported = 0;
  for (let start = 0; start < text.length; start += ELD_WINDOW) {
    const window = text.slice(start, start + ELD_WINDOW);
    if (SUPPORTED.has(eld.detect(window).language)) supported += window.length;
  }
  return text.length === 0 ? 0 : supported / text.length;
}

/**
 * English or Portuguese, card and instructions both (spec 2026-10-24 D1). Script counts first,
 * since they hold on short text where eld does not; eld only when it is reliable or has room.
 */
export function languageVerdict(name: unknown, description: unknown, body: string): LanguageVerdict {
  const prose = proseOf(name, description, body);
  if (prose.length < MIN_PROSE_CHARS) return 'too-short';
  if (typeof description === 'string') {
    if (nonLatinLetterShare(description) > 0.5) return 'description-script';
    const card = eld.detect(latinOnly(description));
    if (card.language && !SUPPORTED.has(card.language) && card.isReliable()) return 'description-language';
  }
  if (nonLatinWordShare(prose) > MAX_NON_LATIN_WORD_SHARE) return 'body-script';
  if (supportedShare(latinOnly(prose)) < 0.5) return 'body-language';
  return 'supported';
}

export function isSupportedLanguage(name: unknown, description: unknown, body: string): boolean {
  return languageVerdict(name, description, body) === 'supported';
}
