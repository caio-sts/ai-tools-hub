import type { RepoRef } from '../../src/types.ts';

/**
 * GraphQL costs 1 point per 4 aliased repositories against a 5,000 point/hour budget (spec §6.2),
 * so 50 aliases per query is ~13 points per call.
 */
export const ENRICH_BATCH_SIZE = 50;

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function splitRepo(repo: string): { owner: string; name: string } {
  if (!REPO_RE.test(repo)) {
    throw new Error(`enrich: invalid repo reference "${repo}"`);
  }
  const [owner, name] = repo.split('/');
  return { owner, name };
}

/** GraphQL aliases must match /^[_A-Za-z][_0-9A-Za-z]*$/, so index them rather than slugging names. */
export function repoAlias(index: number): string {
  return `r${index}`;
}

export function buildEnrichQuery(repos: RepoRef[]): string {
  if (repos.length === 0) {
    throw new Error('enrich: cannot build a query for an empty batch');
  }
  if (repos.length > ENRICH_BATCH_SIZE) {
    throw new Error(
      `enrich: batch of ${repos.length} exceeds ENRICH_BATCH_SIZE ${ENRICH_BATCH_SIZE}`,
    );
  }
  const aliases = repos.map((ref, index) => {
    const { owner, name } = splitRepo(ref.repo);
    return `  ${repoAlias(index)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ...repoFields }`;
  });
  return [
    'fragment repoFields on Repository {',
    '  nameWithOwner',
    '  stargazerCount',
    '  forkCount',
    '  pushedAt',
    '  licenseInfo { spdxId }',
    '  repositoryTopics(first: 25) { nodes { topic { name } } }',
    '  owner { __typename }',
    '}',
    '',
    'query EnrichCollections {',
    '  rateLimit { cost remaining }',
    ...aliases,
    '}',
    '',
  ].join('\n');
}
