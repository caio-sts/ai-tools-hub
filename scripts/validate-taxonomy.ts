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

/** Every slug this taxonomy has ever published. Adding one is deliberate; removing one needs a redirect. */
export const KNOWN_SLUGS: string[] = [
  'security',
  'security/code-application',
  'security/secrets-credentials',
  'security/supply-chain',
  'security/iac-config',
  'security/cloud-permissions',
  'security/containers-kubernetes',
  'security/cicd-pipeline',
  'security/identity-access',
  'security/data-protection',
  'security/offensive-testing',
  'security/detection-forensics',
  'security/compliance-grc',
  'security/ai-agent-security',
  'security/threat-modeling',
  'security/general',
  'coding-software',
  'coding-software/general',
  'devops-infra',
  'devops-infra/general',
  'data-analytics',
  'data-analytics/general',
  'ai-agent-eng',
  'ai-agent-eng/general',
  'docs-formats',
  'docs-formats/general',
  'writing-docs',
  'writing-docs/general',
  'research-knowledge',
  'research-knowledge/general',
  'design-creative',
  'design-creative/general',
  'business-product',
  'business-product/general',
  'productivity',
  'productivity/general',
  'agent-authoring',
  'agent-authoring/general',
  'vertical-domain',
  'vertical-domain/general',
];

/**
 * Retired slug -> the live slug that replaced it. Empty at launch: nothing has been renamed yet.
 * Check 5 makes the first rename a paired edit — drop a slug from the taxonomy and you must add
 * its redirect here in the same commit.
 */
export const SLUG_REDIRECTS: Record<string, string> = {};

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

export function checkSlugStability(
  tax: Taxonomy,
  redirects: Record<string, string> = SLUG_REDIRECTS,
): CheckResult {
  const errors: string[] = [];
  for (const domain of tax.domains) {
    if (!SEGMENT.test(domain.slug)) errors.push(`domain slug "${domain.slug}" is not lowercase kebab-case`);
    for (const child of domain.children ?? []) {
      const parts = child.slug.split('/');
      if (parts.length !== 2 || parts[0] !== domain.slug || !SEGMENT.test(parts[1])) {
        errors.push(`child slug "${child.slug}" must be "${domain.slug}/<kebab-case>"`);
      }
    }
  }
  const live = new Set(flattenTaxonomy(tax).map((n) => n.slug));
  for (const slug of live) {
    if (!KNOWN_SLUGS.includes(slug)) {
      errors.push(`slug "${slug}" is not in KNOWN_SLUGS - add it deliberately, and add a SLUG_REDIRECTS entry if it renames an old slug`);
    }
  }
  for (const slug of KNOWN_SLUGS) {
    if (!live.has(slug) && redirects[slug] === undefined) {
      errors.push(`KNOWN_SLUGS lists "${slug}" but the taxonomy no longer has it - add SLUG_REDIRECTS["${slug}"] pointing at its replacement`);
    }
  }
  for (const [from, to] of Object.entries(redirects)) {
    if (!KNOWN_SLUGS.includes(from)) {
      errors.push(`redirect "${from}" is not in KNOWN_SLUGS - only a retired slug can redirect`);
    } else if (live.has(from)) {
      errors.push(`redirect "${from}" is still a live slug - remove the redirect or remove the node`);
    }
    if (!live.has(to)) {
      errors.push(`redirect "${from}" points at "${to}", which is not a live slug`);
    }
  }
  return { name: '5 slug stability', ok: errors.length === 0, errors };
}

export function runAllChecks(tax: Taxonomy): CheckResult[] {
  return [
    checkMinimumMass(tax),
    checkNamedOverflow(tax),
    checkUniqueSlug(tax),
    checkAliasMap(tax),
    checkSlugStability(tax),
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
