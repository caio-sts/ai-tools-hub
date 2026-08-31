import type { Collection, RepoRef } from '../../src/types.ts';

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

export interface EnrichRepoNode {
  nameWithOwner: string;
  stargazerCount: number;
  forkCount: number;
  pushedAt: string | null;
  licenseInfo: { spdxId: string | null } | null;
  repositoryTopics: { nodes: Array<{ topic: { name: string } } | null> } | null;
  owner: { __typename: string } | null;
}

export interface EnrichPayload {
  data?: Record<string, unknown> | null;
  errors?: Array<{ message: string }> | null;
}

export interface EnrichBatchResult {
  collections: Collection[];
  /** Aliases that resolved to null: renamed, deleted or gone private since discovery. */
  missing: string[];
  /** GraphQL points left in the hour, or -1 when the response omitted rateLimit. */
  remaining: number;
}

export function parseEnrichResponse(
  payload: EnrichPayload,
  batch: RepoRef[],
  curated: ReadonlySet<string>,
): EnrichBatchResult {
  const data = payload.data;
  if (!data) {
    const detail = (payload.errors ?? []).map((e) => e.message).join('; ') || 'no data field';
    throw new Error(`enrich: GraphQL response carried no data (${detail})`);
  }
  const rate = data.rateLimit as { cost: number; remaining: number } | null | undefined;
  const collections: Collection[] = [];
  const missing: string[] = [];

  batch.forEach((ref, index) => {
    const node = data[repoAlias(index)] as EnrichRepoNode | null | undefined;
    if (!node) {
      missing.push(ref.repo);
      return;
    }
    const topics = (node.repositoryTopics?.nodes ?? [])
      .filter((n): n is { topic: { name: string } } => Boolean(n && n.topic && n.topic.name))
      .map((n) => n.topic.name.toLowerCase());
    collections.push({
      // Key on the requested name, not nameWithOwner: skill ids were minted with it upstream.
      repo: ref.repo,
      stars: node.stargazerCount ?? 0,
      forks: node.forkCount ?? 0,
      pushedAt: node.pushedAt ?? '',
      license: node.licenseInfo?.spdxId ?? null,
      topics,
      isOrg: node.owner?.__typename === 'Organization',
      curated: curated.has(ref.repo.toLowerCase()),
    });
  });

  return { collections, missing, remaining: rate?.remaining ?? -1 };
}

export const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

/** Stop the pass while this many GraphQL points remain, rather than emit a truncated corpus. */
export const ENRICH_MIN_BUDGET = 100;

/** Curated marketplaces — worth +12 provenance in the score model (spec §5). */
export const CURATED_REPOS: readonly string[] = [
  'anthropics/skills',
  'openclaw/clawhub',
  'VoltAgent/awesome-openclaw-skills',
  'VoltAgent/awesome-agent-skills',
  'trailofbits/skills',
];

export function curatedSet(extra: readonly string[] = []): Set<string> {
  return new Set([...CURATED_REPOS, ...extra].map((repo) => repo.toLowerCase()));
}

export function dedupeRepos(repos: RepoRef[]): RepoRef[] {
  const seen = new Set<string>();
  const out: RepoRef[] = [];
  for (const ref of repos) {
    const key = ref.repo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

async function postEnrichQuery(query: string, token: string): Promise<EnrichPayload> {
  const res = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      authorization: `bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'ai-tools-hub-harvest',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`enrich: GraphQL HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  return (await res.json()) as EnrichPayload;
}

export async function enrichCollections(repos: RepoRef[], token: string): Promise<Collection[]> {
  if (!token) {
    throw new Error('enrich: a CATALOG_PAT token is required');
  }
  const unique = dedupeRepos(repos);
  const curated = curatedSet();
  const out: Collection[] = [];

  for (let i = 0; i < unique.length; i += ENRICH_BATCH_SIZE) {
    const batch = unique.slice(i, i + ENRICH_BATCH_SIZE);
    const payload = await postEnrichQuery(buildEnrichQuery(batch), token);
    const result = parseEnrichResponse(payload, batch, curated);
    out.push(...result.collections);
    for (const repo of result.missing) {
      console.warn(`enrich: no repository node for ${repo} (renamed, deleted or now private)`);
    }
    if (result.remaining >= 0 && result.remaining < ENRICH_MIN_BUDGET) {
      throw new Error(
        `enrich: GraphQL budget down to ${result.remaining} points after ${out.length} repos — failing loudly instead of committing a partial index`,
      );
    }
  }
  return out;
}
