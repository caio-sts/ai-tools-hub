import { describe, expect, it } from 'vitest';
import {
  isMeaningfulDescription,
  MIN_DESCRIPTION_CHARS,
  MIN_DESCRIPTION_WORDS,
  REPO_SPECIFIC_PHRASES,
} from '../../src/lib/inclusion.ts';

describe('isMeaningfulDescription', () => {
  it('publishes its thresholds as constants', () => {
    expect(MIN_DESCRIPTION_CHARS).toBe(20);
    expect(MIN_DESCRIPTION_WORDS).toBe(4);
    expect([...REPO_SPECIFIC_PHRASES]).toContain('this repo');
  });

  it('accepts a real, reusable description', () => {
    expect(isMeaningfulDescription('Extract text from PDF files.', 'anthropics/skills')).toBe(true);
    expect(
      isMeaningfulDescription('Scans lockfiles for malicious packages.', 'owner/repo'),
    ).toBe(true);
  });

  it('rejects a missing or non-string description', () => {
    expect(isMeaningfulDescription(undefined, 'owner/repo')).toBe(false);
    expect(isMeaningfulDescription(null, 'owner/repo')).toBe(false);
    expect(isMeaningfulDescription(42, 'owner/repo')).toBe(false);
    expect(isMeaningfulDescription({ en: 'x' }, 'owner/repo')).toBe(false);
  });

  it('rejects a trivially short description', () => {
    expect(isMeaningfulDescription('Deploy', 'owner/repo')).toBe(false);
    expect(isMeaningfulDescription('   ', 'owner/repo')).toBe(false);
    expect(isMeaningfulDescription('A helper skill.', 'owner/repo')).toBe(false);
  });

  it('rejects a long description that is only three words', () => {
    expect(isMeaningfulDescription('Supercalifragilistic Expialidocious Skillmaker', 'o/r')).toBe(
      false,
    );
  });

  it('rejects a description that is about the host repository, not the skill', () => {
    expect(
      isMeaningfulDescription('Runs the release checklist for this repo before tagging.', 'o/r'),
    ).toBe(false);
    expect(
      isMeaningfulDescription('Internal use by our team when cutting a release build.', 'o/r'),
    ).toBe(false);
  });

  it('rejects a description that names its own repository', () => {
    expect(
      isMeaningfulDescription(
        'Helper wired into the trailofbits build pipeline and nothing else.',
        'trailofbits/skills',
      ),
    ).toBe(false);
  });

  it('does not treat a generic repo name as repo-specific', () => {
    expect(
      isMeaningfulDescription('Skills for reviewing dependency manifests.', 'anthropics/skills'),
    ).toBe(true);
    expect(
      isMeaningfulDescription('Tools for auditing container image layers.', 'someorg/tools'),
    ).toBe(true);
  });
});
