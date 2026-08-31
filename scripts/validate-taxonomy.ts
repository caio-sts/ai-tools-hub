// The seven taxonomy governance checks of spec §12. Reads the committed taxonomy; takes no argv.
import { pathToFileURL } from 'node:url';
import type { Taxonomy } from '../src/types.ts';
import { flattenTaxonomy, loadTaxonomy } from '../src/lib/taxonomy.ts';

export interface CheckResult {
  name: string;
  ok: boolean;
  errors: string[];
}

export function checkMinimumMass(tax: Taxonomy): CheckResult {
  const errors: string[] = [];
  if (typeof tax.minimumMass !== 'number' || !Number.isInteger(tax.minimumMass)) {
    errors.push(`minimumMass must be an integer, got ${JSON.stringify(tax.minimumMass)}`);
  } else if (tax.minimumMass < 1) {
    errors.push(`minimumMass must be >= 1, got ${tax.minimumMass} (0 silently disables the rule)`);
  } else if (tax.minimumMass > 50) {
    errors.push(`minimumMass must be <= 50, got ${tax.minimumMass} (would hide the whole catalog)`);
  }
  return { name: '1 minimum mass', ok: errors.length === 0, errors };
}

export function runAllChecks(tax: Taxonomy): CheckResult[] {
  return [
    checkMinimumMass(tax),
  ];
}

export function formatResults(results: CheckResult[]): string {
  return results
    .map((r) => (r.ok ? `PASS  ${r.name}` : [`FAIL  ${r.name}`, ...r.errors.map((e) => `        ${e}`)].join('\n')))
    .join('\n');
}

function main(): void {
  const tax = loadTaxonomy();
  const results = runAllChecks(tax);
  console.log(formatResults(results));
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    failed === 0
      ? `\n${results.length} check(s) passed over ${flattenTaxonomy(tax).length} taxonomy nodes`
      : `\n${failed} check(s) failed`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
