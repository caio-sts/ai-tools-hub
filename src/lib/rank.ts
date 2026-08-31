import type { Skill } from '../types.ts';

/** An entry joins a subdomain's listing at rank <= 60 (spec §5.1). */
export const SUBDOMAIN_CAP = 60;

/** … and is only dropped once it falls past rank 72. Applied in Step 6. */
export const EVICT_RANK = 72;

/** The catalog's own order: score descending, ties by id, so ranking is reproducible. */
function byScoreThenId(a: Skill, b: Skill): number {
  return b.score - a.score || a.id.localeCompare(b.id);
}

function countIn(listed: Set<string>, ranked: Skill[]): number {
  let count = 0;
  for (const skill of ranked) if (listed.has(skill.id)) count += 1;
  return count;
}

export function applyListing(skills: Skill[], previous: Set<string>, minimumMass: number): Skill[] {
  const groups = new Map<string, Skill[]>();
  for (const skill of skills) {
    const group = groups.get(skill.primary);
    if (group === undefined) groups.set(skill.primary, [skill]);
    else group.push(skill);
  }

  const listed = new Set<string>();

  for (const group of groups.values()) {
    const ranked = [...group].sort(byScoreThenId);
    for (let i = 0; i < ranked.length; i += 1) {
      const candidate = ranked[i]!;
      const rank = i + 1;
      // Joining takes rank <= 60; staying only takes rank <= 72, so a boundary entry
      // does not flap in and out week to week (spec §5.1).
      const threshold = previous.has(candidate.id) ? EVICT_RANK : SUBDOMAIN_CAP;
      if (rank <= threshold) listed.add(candidate.id);
    }

    // A ceiling, never a floor: eviction may not take a subdomain below the minimum mass
    // §10.1 needs for it to be navigable, so refill from the top until it is met (spec §5.1).
    for (let i = 0; i < ranked.length && countIn(listed, ranked) < minimumMass; i += 1) {
      listed.add(ranked[i]!.id);
    }
  }

  return skills.map((skill) => ({ ...skill, listed: listed.has(skill.id) }));
}
