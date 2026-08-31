import type { Lang } from '../../types.ts';

export type { Lang };

/** Every locale the site routes, in menu order. */
export const LANGS: readonly Lang[] = ['en', 'pt'];
export const DEFAULT_LANG: Lang = 'en';
/** localStorage key holding the visitor's last explicit language choice. */
export const LANG_STORAGE_KEY = 'aith:lang';

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'pt';
}

/** One namespace file: the same key set under every locale. */
export type Namespace = Record<Lang, Record<string, string>>;

export interface MergedStrings {
  tables: Record<Lang, Record<string, string>>;
  /** key -> the namespace that defines it, so a collision can name both sides. */
  owners: Record<string, string>;
}

/**
 * Merges namespaces into one table per locale, refusing a key two namespaces both define.
 * Namespaces are visited in sorted order so the error names the same two files every run.
 */
export function mergeNamespaces(namespaces: Record<string, Namespace>): MergedStrings {
  const tables: Record<Lang, Record<string, string>> = { en: {}, pt: {} };
  const owners: Record<string, string> = {};
  for (const name of Object.keys(namespaces).sort()) {
    const namespace = namespaces[name];
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(namespace[lang] ?? {})) {
        const owner = owners[key];
        if (owner !== undefined && owner !== name) {
          throw new Error(`i18n key "${key}" is defined by both ${owner}.ts and ${name}.ts`);
        }
        owners[key] = name;
        tables[lang][key] = value;
      }
    }
  }
  return { tables, owners };
}

/**
 * Every sibling namespace file, eagerly, index.ts excluded. A section adds strings by creating
 * its own file in this directory — it never edits this one, so no two sections share a file.
 */
const modules = import.meta.glob(['./*.ts', '!./index.ts'], { eager: true }) as Record<
  string,
  { default?: Namespace }
>;

export const NAMESPACES: Record<string, Namespace> = {};
for (const [file, module] of Object.entries(modules)) {
  const table = module.default;
  if (!table) {
    throw new Error(`i18n namespace ${file} must default-export { en, pt }`);
  }
  NAMESPACES[file.slice('./'.length, -'.ts'.length)] = table;
}

const merged = mergeNamespaces(NAMESPACES);

export const UI: Record<Lang, Record<string, string>> = merged.tables;
export const KEY_OWNERS: Record<string, string> = merged.owners;

/** Looks up a UI string. Missing keys fall back to English, then to the key itself. */
export function t(key: string, lang: Lang): string {
  const table = UI[lang] ?? UI[DEFAULT_LANG];
  return table[key] ?? UI[DEFAULT_LANG][key] ?? key;
}
