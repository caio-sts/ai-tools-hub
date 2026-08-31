import type { Runtime, Safety, TreeFile } from '../types.ts';

/**
 * The single runtime ordering used everywhere. Never sort runtimes alphabetically.
 * Declared here, in the UI-safe module, so a page can import the order without dragging
 * `scripts/harvest/enrich.ts` (and its GraphQL fetch code) into the site build.
 */
export const RUNTIME_ORDER: readonly Runtime[] = ['claude', 'openclaw', 'codex', 'cursor', 'generic'];

/** Git mode for a symlink. 458 of 846 SKILL.md paths in one sampled repo are these (spec §6.3). */
export const SYMLINK_MODE = '120000';
/** Git mode for an executable blob. */
export const EXECUTABLE_MODE = '100755';

export const SCRIPT_LANGUAGES: Record<string, string> = {
  '.py': 'python',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.rb': 'ruby',
  '.go': 'go',
  '.pl': 'perl',
  '.ps1': 'powershell',
  '.rs': 'rust',
  '.php': 'php',
  '.lua': 'lua',
};

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

export function languageOf(path: string): string | null {
  return SCRIPT_LANGUAGES[extensionOf(path)] ?? null;
}

/** "skills/pdf/SKILL.md" -> "skills/pdf"; "SKILL.md" -> "". */
export function skillDirOf(skillPath: string): string {
  const cut = skillPath.lastIndexOf('/');
  return cut === -1 ? '' : skillPath.slice(0, cut);
}

/** A real, executable blob living under some `scripts/` segment. */
export function isScriptEntry(file: TreeFile): boolean {
  if (file.type !== 'blob') return false;
  if (file.mode === SYMLINK_MODE) return false;
  if (!file.path.startsWith('scripts/') && !file.path.includes('/scripts/')) return false;
  return languageOf(file.path) !== null || file.mode === EXECUTABLE_MODE;
}

/**
 * Script files belonging to exactly this skill: `<skill dir>/scripts/**`.
 * Argument order is (tree, skillPath) and is fixed — this is the repo's only definition.
 */
export function scriptFilesFor(tree: TreeFile[], skillPath: string): TreeFile[] {
  const dir = skillDirOf(skillPath);
  const prefix = dir === '' ? 'scripts/' : `${dir}/scripts/`;
  return tree.filter((file) => file.path.startsWith(prefix) && isScriptEntry(file));
}

/**
 * Published ruleset for the "network reach" row (spec §4.3). No `g` flag anywhere: a global
 * regex keeps lastIndex between .test() calls and starts returning false negatives.
 */
export const NETWORK_PATTERNS: readonly RegExp[] = [
  /\bhttps?:\/\//i,
  /\bcurl\b/,
  /\bwget\b/,
  /\bfetch\s*\(/,
  /\brequests\s*\.\s*(?:get|post|put|patch|delete|head|request|session|Session)\b/,
  /\burllib\b/,
  /\bhttp\.client\b/,
  /\baxios\b/,
  /\bnode-fetch\b/,
  /\bnet\/http\b/,
  /\bHttpClient\b/,
  /\bsocket\s*\.\s*(?:connect|create_connection)\b/,
  /\bInvoke-(?:WebRequest|RestMethod)\b/i,
];

/** Published ruleset for the "credential reach" row (spec §4.3). */
export const ENV_PATTERNS: readonly RegExp[] = [
  /\bprocess\.env\b/,
  /\bos\.environ\b/,
  /\bgetenv\s*\(/,
  /\bENV\[/,
  /\$ENV\b/,
  /\bSystem\.getenv\b/,
  /\bDeno\.env\b/,
  /\$\{?[A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|APIKEY|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*\}?/,
];

export function scansNetwork(source: string): boolean {
  return NETWORK_PATTERNS.some((pattern) => pattern.test(source));
}

export function readsEnvironment(source: string): boolean {
  return ENV_PATTERNS.some((pattern) => pattern.test(source));
}

/** The reference validator's exact vocabulary (spec §4.2). No category, tags, author or version. */
export const ALLOWED_FIELDS: readonly string[] = [
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
  'compatibility',
];

const ALLOWED_FIELD_SET = new Set(ALLOWED_FIELDS);

/**
 * True when every frontmatter key is spec-conformant — the +9 completeness term (spec §5).
 * One argument, defined once, here. Portability is a property of the frontmatter alone.
 */
export function isPortable(frontmatter: Record<string, unknown>): boolean {
  return Object.keys(frontmatter).every((key) => ALLOWED_FIELD_SET.has(key));
}

/** `allowed-tools` verbatim, else null ("not declared"). Present on only 9% of skills. */
export function declaredTools(frontmatter: Record<string, unknown>): string[] | null {
  const raw = frontmatter['allowed-tools'];
  let tools: string[];
  if (Array.isArray(raw)) {
    tools = raw.map((tool) => String(tool).trim());
  } else if (typeof raw === 'string') {
    tools = raw.split(',').map((tool) => tool.trim());
  } else {
    return null;
  }
  const cleaned = tools.filter((tool) => tool !== '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * The derived safety surface (spec §4.3). Derived, never declared: `allowed-tools` exists on only
 * 9% of skills. All three parameters are required — dropping `frontmatter` is what made
 * declaredTools null for the entire corpus. `files` may be the output of scriptFilesFor or every
 * entry under the skill dir; isScriptEntry re-filters either way. A script whose content was not
 * fetched contributes no network/env signal; this module never claims a skill is safe.
 */
export function deriveSafety(
  files: TreeFile[],
  contents: Map<string, string>,
  frontmatter: Record<string, unknown>,
): Safety {
  const scripts = files.filter(isScriptEntry);
  const languages = [
    ...new Set(
      scripts
        .map((file) => languageOf(file.path))
        .filter((language): language is string => language !== null),
    ),
  ].sort();

  let network = false;
  let readsEnv = false;
  for (const file of scripts) {
    const source = contents.get(file.path);
    if (source === undefined) continue;
    if (!network && scansNetwork(source)) network = true;
    if (!readsEnv && readsEnvironment(source)) readsEnv = true;
    if (network && readsEnv) break;
  }

  return {
    executesCode: scripts.length > 0,
    scriptCount: scripts.length,
    languages,
    network,
    readsEnv,
    declaredTools: declaredTools(frontmatter),
  };
}
