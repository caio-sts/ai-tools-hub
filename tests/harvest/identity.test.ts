import { describe, expect, it } from 'vitest';
import { compatibilityTopics, isSecurityRelevant, skillId } from '../../scripts/harvest/run.ts';

describe('skillId', () => {
  it('synthesises owner/repo@sha:path', () => {
    expect(skillId('trailofbits/skills', '9f1c2ab', 'skills/semgrep-triage/SKILL.md')).toBe(
      'trailofbits/skills@9f1c2ab:skills/semgrep-triage/SKILL.md',
    );
  });

  it('handles a root-level SKILL.md', () => {
    expect(skillId('someone/one-skill', 'abc1234', 'SKILL.md')).toBe('someone/one-skill@abc1234:SKILL.md');
  });

  it('round-trips into the three parts the catalog test re-derives', () => {
    const id = skillId('a/b', 'deadbee', 'skills/x/SKILL.md');
    const [repoAndSha, ...rest] = id.split(':');
    expect(repoAndSha).toBe('a/b@deadbee');
    expect(rest.join(':')).toBe('skills/x/SKILL.md');
  });
});

describe('isSecurityRelevant (cross-cutting flag, spec §3.4)', () => {
  it('flags security work regardless of the primary domain', () => {
    expect(isSecurityRelevant('Audit IAM policies for least privilege')).toBe(true);
    expect(isSecurityRelevant('Run Semgrep and triage vulnerabilities by severity.')).toBe(true);
    expect(isSecurityRelevant('Terraform module linter with supply chain checks')).toBe(true);
    expect(isSecurityRelevant('Test an agent for prompt injection')).toBe(true);
  });

  it('does not flag unrelated skills', () => {
    expect(isSecurityRelevant('Generate release notes from the git history since the last tag.')).toBe(false);
    expect(isSecurityRelevant('Convert a CSV file into a markdown table')).toBe(false);
  });

  it('does not fire on acronyms embedded in ordinary words', () => {
    expect(isSecurityRelevant('Plan a trip to Miami')).toBe(false);
  });
});

describe('compatibilityTopics (frontmatter compatibility, spec §4.2)', () => {
  it('returns an array field verbatim', () => {
    expect(compatibilityTopics({ compatibility: ['cursor', 'openclaw'] })).toEqual(['cursor', 'openclaw']);
  });

  it('wraps a scalar string', () => {
    expect(compatibilityTopics({ compatibility: 'openclaw' })).toEqual(['openclaw']);
  });

  it('drops non-string entries and returns empty when the field is absent', () => {
    expect(compatibilityTopics({ compatibility: ['cursor', 7, null] })).toEqual(['cursor']);
    expect(compatibilityTopics({})).toEqual([]);
    expect(compatibilityTopics({ compatibility: 42 })).toEqual([]);
  });
});
