import { describe, expect, it } from 'vitest';
import { MIN_PROSE_CHARS, isSupportedLanguage, proseOf } from '../../scripts/harvest/language.ts';

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
});

describe('proseOf', () => {
  it('joins name, description and body, dropping code, URLs, HTML and markup', () => {
    const body = '## Usage\n\nRun `scan --all` first.\n\n```bash\nrm -rf /\n```\n\nSee <b>docs</b> at https://example.com/x.';
    expect(proseOf('secret-scan', 'Finds leaked keys.', body)).toBe(
      'secret scan Finds leaked keys. Usage Run first. See docs at',
    );
  });

  it('ignores a name or description that is not a string', () => {
    expect(proseOf(undefined, 42, 'Body text.')).toBe('Body text.');
  });
});
