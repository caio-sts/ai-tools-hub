import { describe, expect, it } from 'vitest';
import { MIN_PROSE_CHARS, isSupportedLanguage, languageVerdict, proseOf } from '../../scripts/harvest/language.ts';

const ENGLISH =
  'Scan a repository for leaked credentials before every release. The skill walks the git history, ' +
  'flags tokens that look like cloud keys, and explains how to rotate each one safely.';
const PORTUGUESE =
  'Analisa o repositório em busca de credenciais vazadas antes de cada versão. A skill percorre o ' +
  'histórico do git, aponta chaves de nuvem expostas e explica como trocar cada uma com segurança.';
const GERMAN =
  'Prüft das Repository vor jeder Veröffentlichung auf geleakte Zugangsdaten. Der Skill durchsucht ' +
  'die Git-Historie, markiert verdächtige Schlüssel und erklärt, wie man sie sicher austauscht.';
const CHINESE_WITH_ENGLISH_TERMS =
  'Codex adapter note: shared by Claude Code and Codex. 在每次 release 之前扫描 repository 中泄露的 ' +
  'credentials。该技能会遍历 git history，标记看起来像 cloud key 的 token，并说明如何安全地轮换每一个密钥，' +
  '然后生成一份报告，列出所有需要处理的问题以及建议的修复步骤。';
const JAPANESE =
  'リリースの前にリポジトリを走査して、漏洩した認証情報を探します。このスキルはコミット履歴をたどり、' +
  'クラウドの鍵に見えるトークンを指摘し、それぞれを安全に交換する方法を説明します。';

const SHORT = 'Leaked credential scan.';

describe('isSupportedLanguage (spec 2026-10-24 D1)', () => {
  it('admits English and Portuguese', () => {
    expect(isSupportedLanguage('secret-scan', SHORT, ENGLISH)).toBe(true);
    expect(isSupportedLanguage('secret-scan', 'Busca de credenciais vazadas.', PORTUGUESE)).toBe(true);
  });

  it('rejects another Latin-script language', () => {
    expect(isSupportedLanguage('secret-scan', 'Sucht geleakte Zugangsdaten.', GERMAN)).toBe(false);
  });

  it('rejects mostly non-Latin instructions, even when English terms and headers are mixed in', () => {
    expect(isSupportedLanguage('secret-scan', SHORT, CHINESE_WITH_ENGLISH_TERMS)).toBe(false);
    expect(isSupportedLanguage('secret-scan', SHORT, JAPANESE)).toBe(false);
  });

  it('rejects a non-Latin description even over English instructions: the card would be unreadable', () => {
    expect(isSupportedLanguage('secret-scan', '漏洩した認証情報をリポジトリから探すスキル。', ENGLISH)).toBe(false);
    expect(isSupportedLanguage('secret-scan', 'Поиск утекших учетных данных в репозитории.', ENGLISH)).toBe(false);
  });

  it('keeps English that only mentions a word in another script', () => {
    expect(isSupportedLanguage('secret-scan', SHORT, `${ENGLISH} It also reads keys labelled 鍵.`)).toBe(true);
  });

  it('rejects prose too short to judge', () => {
    expect(proseOf('scan', SHORT, '').length).toBeLessThan(MIN_PROSE_CHARS);
    expect(isSupportedLanguage('scan', SHORT, '')).toBe(false);
  });

  it('rejects a Latin-script description in another language over English instructions', () => {
    expect(isSupportedLanguage('secret-scan', 'Prüft das Repository vor jeder Veröffentlichung auf geleakte Zugangsdaten.', ENGLISH)).toBe(false);
    expect(isSupportedLanguage('secret-scan', 'Analiza el repositorio en busca de credenciales filtradas antes de cada versión.', ENGLISH)).toBe(false);
  });

  it('judges the whole body, not the first 1,000 characters eld reads', () => {
    const intro = `${ENGLISH} `.repeat(4);
    expect(isSupportedLanguage('secret-scan', SHORT, `${intro}\n\n${`${GERMAN} `.repeat(10)}`)).toBe(false);
    expect(isSupportedLanguage('secret-scan', SHORT, `${`${ENGLISH} `.repeat(10)}\n\nBeispiel: ${GERMAN}`)).toBe(true);
  });

  it('keeps English whose Markdown used to erase it: nested fences, autolinks, bare angle brackets', () => {
    const nested = `\`\`\`\`markdown\n\`\`\`bash\necho hi\n\`\`\`\n\`\`\`\`\n\n${ENGLISH}\n\n${ENGLISH}\n\nThen run \`scan --all\`.`;
    expect(isSupportedLanguage('secret-scan', SHORT, nested)).toBe(true);
    const autolink = `Docs live at <https://example.com/docs>.\n\n${ENGLISH}\n\n${ENGLISH}\n\n> **Note:** run it on a clean checkout.`;
    expect(isSupportedLanguage('secret-scan', SHORT, autolink)).toBe(true);
    const angles = `${ENGLISH}\n\n${ENGLISH}\n\nWhen done -> open a pull request.`;
    expect(isSupportedLanguage('secret-scan', 'Splits any function longer than <50 lines into helpers.', angles)).toBe(true);
  });
});

describe('languageVerdict', () => {
  it('names the rule that excluded a skill', () => {
    expect(languageVerdict('scan', SHORT, '')).toBe('too-short');
    expect(languageVerdict('secret-scan', '漏洩した認証情報をリポジトリから探すスキル。', ENGLISH)).toBe('description-script');
    expect(languageVerdict('secret-scan', 'Prüft das Repository vor jeder Veröffentlichung auf geleakte Zugangsdaten.', ENGLISH)).toBe('description-language');
    expect(languageVerdict('secret-scan', SHORT, CHINESE_WITH_ENGLISH_TERMS)).toBe('body-script');
    expect(languageVerdict('secret-scan', SHORT, `${GERMAN} ${GERMAN}`)).toBe('body-language');
    expect(languageVerdict('secret-scan', SHORT, ENGLISH)).toBe('supported');
  });
});

describe('proseOf', () => {
  it('joins name, description and body, dropping code, URLs, HTML and markup', () => {
    const body = '## Usage\n\nRun `scan --all` first.\n\n```bash\nrm -rf /\n```\n\nSee <b>docs</b> at https://example.com/x.';
    expect(proseOf('secret-scan', 'Finds leaked keys.', body)).toBe(
      'secret scan Finds leaked keys. Usage Run first. See docs at',
    );
  });

  it('drops tilde fences too', () => {
    expect(proseOf(undefined, undefined, 'Before.\n\n~~~bash\nexport AWS_SECRET_ACCESS_KEY=abc\n~~~\n\nAfter.')).toBe('Before. After.');
  });

  it('ignores a name or description that is not a string', () => {
    expect(proseOf(undefined, 42, 'Body text.')).toBe('Body text.');
  });
});
