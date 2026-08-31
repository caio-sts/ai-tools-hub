import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkMinimumMass } from '../../scripts/validate-taxonomy.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

describe('check 1 - minimum mass', () => {
  it('passes on the committed taxonomy', () => {
    expect(checkMinimumMass(loadTaxonomy())).toEqual({ name: '1 minimum mass', ok: true, errors: [] });
  });

  it('rejects a zero threshold, which silently disables the rule', () => {
    const tax = mutable();
    tax.minimumMass = 0;
    const result = checkMinimumMass(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('minimumMass must be >= 1');
  });

  it('rejects a non-integer threshold', () => {
    const tax = mutable();
    tax.minimumMass = 5.5;
    const result = checkMinimumMass(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('must be an integer');
  });

  it('rejects an absurd threshold that would hide the whole catalog', () => {
    const tax = mutable();
    tax.minimumMass = 500;
    const result = checkMinimumMass(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('must be <= 50');
  });
});

describe('the validate CLI', () => {
  it('exits 0 on the committed taxonomy', () => {
    const stdout = execFileSync('node', ['scripts/validate-taxonomy.ts'], { cwd: ROOT, encoding: 'utf8' });
    expect(stdout).toContain('PASS  1 minimum mass');
  });
});
