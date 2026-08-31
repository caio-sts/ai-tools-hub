import { describe, expect, it } from 'vitest';
import {
  includeSkill,
  INCLUSION_RULE_ORDER,
  type SkillCandidate,
} from '../../src/lib/inclusion.ts';

function candidate(over: Partial<SkillCandidate> = {}): SkillCandidate {
  return {
    repo: 'owner/repo',
    path: 'skills/alpha/SKILL.md',
    hasReadme: true,
    description: 'Scans lockfiles for malicious packages.',
    ...over,
  };
}

describe('includeSkill', () => {
  it('publishes the rule order so /methodology can render it', () => {
    expect([...INCLUSION_RULE_ORDER]).toEqual(['repo-internal', 'no-readme', 'weak-description']);
  });

  it('includes a candidate that clears every rule', () => {
    expect(includeSkill(candidate())).toBe('included');
  });

  it('reports the first failing rule, in published order', () => {
    expect(
      includeSkill(
        candidate({ path: '.claude/skills/x/SKILL.md', hasReadme: false, description: 'no' }),
      ),
    ).toBe('repo-internal');
    expect(includeSkill(candidate({ hasReadme: false, description: 'no' }))).toBe('no-readme');
    expect(includeSkill(candidate({ description: 'no' }))).toBe('weak-description');
  });

  it('rejects a nested repo-internal path', () => {
    expect(includeSkill(candidate({ path: 'packages/api/.claude/skills/x/SKILL.md' }))).toBe(
      'repo-internal',
    );
  });

  it('rejects a missing description', () => {
    expect(includeSkill(candidate({ description: undefined }))).toBe('weak-description');
  });
});
