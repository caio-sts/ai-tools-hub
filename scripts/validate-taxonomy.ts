// The seven taxonomy governance checks of spec §12. Reads the committed taxonomy; takes no argv.
import { pathToFileURL } from 'node:url';
import type { Taxonomy } from '../src/types.ts';
import { flattenTaxonomy, loadTaxonomy } from '../src/lib/taxonomy.ts';

export interface CheckResult {
  name: string;
  ok: boolean;
  errors: string[];
}

const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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

export function checkNamedOverflow(tax: Taxonomy): CheckResult {
  const errors: string[] = [];
  for (const domain of tax.domains) {
    const wanted = `${domain.slug}/general`;
    const leaf = (domain.children ?? []).find((c) => c.slug === wanted);
    if (leaf === undefined) {
      errors.push(`domain "${domain.slug}" has no named overflow leaf "${wanted}"`);
      continue;
    }
    if (leaf.name.en.trim() === '' || leaf.name.pt.trim() === '') {
      errors.push(`overflow leaf "${wanted}" needs a non-empty name in both locales`);
    }
  }
  return { name: '2 named overflow', ok: errors.length === 0, errors };
}

export function checkUniqueSlug(tax: Taxonomy): CheckResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const node of flattenTaxonomy(tax)) {
    if (seen.has(node.slug)) errors.push(`duplicate slug "${node.slug}"`);
    seen.add(node.slug);
  }
  return { name: '3 unique slug', ok: errors.length === 0, errors };
}

export function checkAliasMap(tax: Taxonomy): CheckResult {
  const errors: string[] = [];
  const nodes = flattenTaxonomy(tax);
  const slugs = new Set(nodes.map((n) => n.slug));
  for (const [alias, target] of Object.entries(tax.aliases)) {
    if (!SEGMENT.test(alias)) errors.push(`alias key "${alias}" is not lowercase kebab-case`);
    if (slugs.has(alias) || nodes.some((n) => n.slug.endsWith(`/${alias}`))) {
      errors.push(`alias key "${alias}" shadows a real node slug`);
    }
    const matches = nodes.filter((n) => n.slug === target || n.slug.endsWith(`/${target}`));
    if (matches.length === 0) errors.push(`alias "${alias}" points at "${target}", which is not a node`);
    if (matches.length > 1) {
      errors.push(`alias "${alias}" points at "${target}", which is ambiguous: ${matches.map((m) => m.slug).join(', ')}`);
    }
  }
  return { name: '4 alias map', ok: errors.length === 0, errors };
}

export function runAllChecks(tax: Taxonomy): CheckResult[] {
  return [
    checkMinimumMass(tax),
    checkNamedOverflow(tax),
    checkUniqueSlug(tax),
    checkAliasMap(tax),
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
