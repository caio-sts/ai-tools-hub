import { describe, expect, it } from 'vitest';
import { ALLOWED_FIELDS, declaredTools, isPortable } from '../../src/lib/safety.ts';

describe('isPortable', () => {
  it('takes frontmatter alone — no second path argument', () => {
    expect(isPortable.length).toBe(1);
  });

  it('accepts frontmatter whose keys are a subset of ALLOWED_FIELDS', () => {
    expect(isPortable({ name: 'pdf', description: 'Fill PDF forms' })).toBe(true);
    expect(
      isPortable({
        name: 'pdf',
        description: 'Fill PDF forms',
        license: 'Apache-2.0',
        'allowed-tools': ['Bash'],
        metadata: { x: 1 },
        compatibility: ['claude-code'],
      }),
    ).toBe(true);
  });

  it('rejects any field outside the reference validator vocabulary', () => {
    expect(isPortable({ name: 'pdf', category: 'security' })).toBe(false);
    expect(isPortable({ name: 'pdf', tags: ['sbom'] })).toBe(false);
    expect(isPortable({ name: 'pdf', version: '1.0.0' })).toBe(false);
    expect(isPortable({ name: 'pdf', author: 'someone' })).toBe(false);
  });

  it('is case-sensitive, matching the validator', () => {
    expect(isPortable({ Name: 'pdf' })).toBe(false);
    expect(isPortable({ 'allowed_tools': ['Bash'] })).toBe(false);
  });

  it('publishes the vocabulary', () => {
    expect([...ALLOWED_FIELDS].sort()).toEqual([
      'allowed-tools',
      'compatibility',
      'description',
      'license',
      'metadata',
      'name',
    ]);
  });
});

describe('declaredTools', () => {
  it('returns the array verbatim', () => {
    expect(declaredTools({ 'allowed-tools': ['Bash', 'Read', 'Write'] })).toEqual([
      'Bash',
      'Read',
      'Write',
    ]);
  });

  it('splits the comma-separated string form', () => {
    expect(declaredTools({ 'allowed-tools': 'Bash, Read , Grep' })).toEqual(['Bash', 'Read', 'Grep']);
  });

  it('returns null when nothing usable is declared — the 91% case', () => {
    expect(declaredTools({})).toBeNull();
    expect(declaredTools({ name: 'pdf' })).toBeNull();
    expect(declaredTools({ 'allowed-tools': '' })).toBeNull();
    expect(declaredTools({ 'allowed-tools': [] })).toBeNull();
    expect(declaredTools({ 'allowed-tools': ['', '  '] })).toBeNull();
    expect(declaredTools({ 'allowed-tools': 42 })).toBeNull();
  });
});
