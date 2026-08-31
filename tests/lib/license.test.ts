import { describe, expect, it } from 'vitest';
import { resolveLicense, sniffSpdx } from '../../src/lib/license.ts';

const APACHE = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/`;

describe('resolveLicense', () => {
  it('takes a single LicenseInput object, not positional arguments', () => {
    expect(resolveLicense.length).toBe(1);
  });

  it('tier 1: frontmatter license wins over everything', () => {
    expect(
      resolveLicense({
        frontmatter: { name: 'pdf', license: ' MIT ' },
        skillPath: 'skills/pdf/SKILL.md',
        treePaths: ['skills/pdf/SKILL.md', 'skills/pdf/LICENSE.txt'],
        repoLicense: 'Apache-2.0',
        siblingLicenseText: APACHE,
      }),
    ).toEqual({ license: 'MIT', licenseSource: 'frontmatter' });
  });

  it('tier 2: a sibling LICENSE file in the skill directory, sniffed to an SPDX id', () => {
    // anthropics/skills: repo license is null, per-skill LICENSE.txt is Apache-2.0.
    expect(
      resolveLicense({
        frontmatter: { name: 'pdf', description: 'Fill PDF forms' },
        skillPath: 'document-skills/pdf/SKILL.md',
        treePaths: [
          'document-skills/pdf/SKILL.md',
          'document-skills/pdf/LICENSE.txt',
          'document-skills/docx/SKILL.md',
        ],
        repoLicense: null,
        siblingLicenseText: APACHE,
      }),
    ).toEqual({ license: 'Apache-2.0', licenseSource: 'sibling' });
  });

  it('tier 2 ignores a LICENSE that belongs to a different skill directory', () => {
    expect(
      resolveLicense({
        frontmatter: {},
        skillPath: 'document-skills/docx/SKILL.md',
        treePaths: ['document-skills/docx/SKILL.md', 'document-skills/pdf/LICENSE.txt'],
        repoLicense: null,
      }),
    ).toEqual({ license: null, licenseSource: null });
  });

  it('tier 2 records an unreadable sibling as a custom license reference', () => {
    expect(
      resolveLicense({
        frontmatter: {},
        skillPath: 'skills/x/SKILL.md',
        treePaths: ['skills/x/SKILL.md', 'skills/x/LICENCE'],
        repoLicense: null,
        siblingLicenseText: 'Copyright 2026. All rights reserved to nobody in particular.',
      }),
    ).toEqual({ license: 'LicenseRef-Custom', licenseSource: 'sibling' });
  });

  it('tier 3: repo SPDX, with NOASSERTION recorded as a custom reference', () => {
    expect(
      resolveLicense({
        frontmatter: {},
        skillPath: 'skills/x/SKILL.md',
        treePaths: ['skills/x/SKILL.md'],
        repoLicense: 'MIT',
      }),
    ).toEqual({ license: 'MIT', licenseSource: 'repo' });
    expect(
      resolveLicense({
        frontmatter: {},
        skillPath: 'skills/x/SKILL.md',
        treePaths: ['skills/x/SKILL.md'],
        repoLicense: 'NOASSERTION',
      }),
    ).toEqual({ license: 'LicenseRef-Custom', licenseSource: 'repo' });
  });

  it('tier 4: nothing declared anywhere', () => {
    expect(
      resolveLicense({
        frontmatter: { license: '   ' },
        skillPath: 'SKILL.md',
        treePaths: ['SKILL.md'],
        repoLicense: '',
      }),
    ).toEqual({ license: null, licenseSource: null });
  });

  it('sniffs the common SPDX ids out of license text', () => {
    expect(sniffSpdx(APACHE)).toBe('Apache-2.0');
    expect(sniffSpdx('MIT License\n\nPermission is hereby granted, free of charge')).toBe('MIT');
    expect(sniffSpdx('GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007')).toBe('GPL-3.0');
    expect(sniffSpdx('This is free and unencumbered software released into the public domain.')).toBe(
      'Unlicense',
    );
    expect(sniffSpdx('some prose')).toBeNull();
  });
});
