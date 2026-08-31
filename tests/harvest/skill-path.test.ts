import { describe, expect, it } from 'vitest';
import { isSkillPath } from '../../scripts/harvest/enumerate.ts';

describe('isSkillPath', () => {
  it('accepts a SKILL.md inside a skill directory', () => {
    expect(isSkillPath('skills/pdf-processing/SKILL.md')).toBe(true);
    expect(isSkillPath('a/b/c/d/SKILL.md')).toBe(true);
  });

  it('rejects anything that is not a directory-scoped SKILL.md', () => {
    expect(isSkillPath('SKILL.md')).toBe(false);
    expect(isSkillPath('skills/a/README.md')).toBe(false);
    expect(isSkillPath('skills/a/SKILL.md.bak')).toBe(false);
    expect(isSkillPath('skills/a/skill.md')).toBe(false);
    expect(isSkillPath('docs/HOW-TO-WRITE-A-SKILL.md')).toBe(false);
    expect(isSkillPath('')).toBe(false);
  });
});
