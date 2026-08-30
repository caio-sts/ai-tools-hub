export type Lang = 'en' | 'pt';

// Written in RUNTIME_ORDER, never alphabetically. The constant itself lives in
// src/lib/safety.ts; this union only fixes the order everything else displays.
export type Runtime = 'claude' | 'openclaw' | 'codex' | 'cursor' | 'generic';

export interface TreeFile { path: string; mode: string; sha: string; type: string; }
export interface RepoRef { repo: string; stars: number; }

// data/collections.json is a bare Collection[] — the only place stars and forks live.
export interface Collection {
  repo: string; stars: number; forks: number; pushedAt: string;
  license: string | null; topics: string[]; isOrg: boolean; curated: boolean;
}

export interface Safety {
  executesCode: boolean; scriptCount: number; languages: string[];
  network: boolean; readsEnv: boolean; declaredTools: string[] | null;
}

export interface ScoreBreakdown {
  adoption: number;      // 0-25
  maintenance: number;   // 0-30
  provenance: number;    // 0-25
  completeness: number;  // 0-20
  total: number;         // 0-100, and always === Skill.score
}

export interface RawSkill {
  repo: string; path: string; sha: string; blobSha: string;
  frontmatter: Record<string, unknown>; body: string; updatedDays: number;
}

// data/skills.json is a bare Skill[].
export interface Skill {
  id: string;                 // "owner/repo@sha:path"
  type: 'skill';
  name: string;
  description: string;
  descriptionPt: string | null;
  longPt: string | null;
  repo: string; path: string; sha: string;
  updatedDays: number;        // per PATH, not per repo
  indexedAt: string;          // ISO date
  license: string | null;
  licenseSource: 'frontmatter' | 'sibling' | 'repo' | null;
  portable: boolean;
  runtimes: Runtime[];
  safety: Safety;
  primary: string;            // "security/supply-chain"
  also: string[];             // max 2
  tags: string[];             // max 10
  securityRelevant: boolean;
  score: number;
  breakdown: ScoreBreakdown;
  /** False once evicted by the per-subdomain cap (§5.1). The row survives and keeps
   *  being re-scored; only the listing goes away. */
  listed: boolean;
}

export interface TaxonomyNode {
  slug: string;               // "security/supply-chain" for children, "security" for domains
  name: { en: string; pt: string };
  children?: TaxonomyNode[];
  frameworkRefs?: string[];
}

export interface Taxonomy {
  domains: TaxonomyNode[];
  protected: string[];
  aliases: Record<string, string>;
  minimumMass: number;        // 5
}

// data/assignments.json is an Assignments object keyed by Skill.id — never an array.
export interface Assignment {
  primary: string;
  also: string[];
  tags: string[];
}
export type Assignments = Record<string, Assignment>;

// data/meta.json is one Meta object. classifiedAt is null until the first
// classification pass runs, so the staleness banner can report the two lags apart.
export interface Meta {
  crawledAt: string;
  classifiedAt: string | null;
  skillCount: number;
  sourceCount: number;
}
