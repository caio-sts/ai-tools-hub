import type { Skill } from '../types.ts';

/** Kept in lockstep with Skill.licenseSource so the two can never drift apart. */
export type LicenseSource = Skill['licenseSource'];

export interface LicenseInput {
  /** Parsed SKILL.md frontmatter. */
  frontmatter: Record<string, unknown>;
  /** Repo-relative path of the SKILL.md, e.g. "document-skills/pdf/SKILL.md". */
  skillPath: string;
  /** Every blob path in the repo tree. */
  treePaths: string[];
  /** Collection.license — GitHub's repo-level SPDX id, often null. */
  repoLicense: string | null;
  /** Text of the sibling LICENSE file when it was fetched; omit to skip sniffing. */
  siblingLicenseText?: string | null;
}

export interface LicenseResolution {
  license: string | null;
  licenseSource: LicenseSource;
}

export const SPDX_SIGNATURES: ReadonlyArray<readonly [RegExp, string]> = [
  [/apache license[\s\S]{0,40}version 2\.0/i, 'Apache-2.0'],
  [/mit license|permission is hereby granted, free of charge/i, 'MIT'],
  [/gnu affero general public license/i, 'AGPL-3.0'],
  [/gnu general public license[\s\S]{0,40}version 3/i, 'GPL-3.0'],
  [/gnu general public license[\s\S]{0,40}version 2/i, 'GPL-2.0'],
  [/gnu lesser general public license/i, 'LGPL-3.0'],
  [/mozilla public license[\s\S]{0,40}2\.0/i, 'MPL-2.0'],
  [/redistribution and use[\s\S]{0,400}neither the name/i, 'BSD-3-Clause'],
  [/redistribution and use/i, 'BSD-2-Clause'],
  [/creative commons legal code[\s\S]{0,80}cc0/i, 'CC0-1.0'],
  [/this is free and unencumbered software released into the public domain/i, 'Unlicense'],
  [/isc license/i, 'ISC'],
];

export function sniffSpdx(text: string): string | null {
  for (const [pattern, id] of SPDX_SIGNATURES) {
    if (pattern.test(text)) return id;
  }
  return null;
}

function parentDir(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

function baseName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

/** The repo's only license resolver. One argument, four tiers, the winning tier recorded. */
export function resolveLicense(input: LicenseInput): LicenseResolution {
  // Tier 1 — the skill declares it itself.
  const declared = input.frontmatter.license;
  if (typeof declared === 'string' && declared.trim() !== '') {
    return { license: declared.trim(), licenseSource: 'frontmatter' };
  }

  // Tier 2 — a LICENSE* file sitting next to this SKILL.md. anthropics/skills needs this.
  const dir = parentDir(input.skillPath);
  const sibling = input.treePaths.find(
    (path) => parentDir(path) === dir && /^licen[cs]e/i.test(baseName(path)),
  );
  if (sibling) {
    const text = input.siblingLicenseText;
    const sniffed = typeof text === 'string' ? sniffSpdx(text) : null;
    return { license: sniffed ?? 'LicenseRef-Custom', licenseSource: 'sibling' };
  }

  // Tier 3 — the repo's own SPDX id. GitHub reports "NOASSERTION" for an unrecognised license file.
  const repo = (input.repoLicense ?? '').trim();
  if (repo !== '') {
    return {
      license: repo === 'NOASSERTION' ? 'LicenseRef-Custom' : repo,
      licenseSource: 'repo',
    };
  }

  return { license: null, licenseSource: null };
}
