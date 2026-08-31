import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import { hasReadme, isRepoInternal } from '../../src/lib/inclusion.ts';

function blob(path: string): TreeFile {
  return { path, mode: '100644', sha: `sha-${path}`, type: 'blob' };
}

describe('hasReadme', () => {
  it('accepts a repository-root README in any common extension', () => {
    expect(hasReadme([blob('README.md')])).toBe(true);
    expect(hasReadme([blob('readme.rst')])).toBe(true);
    expect(hasReadme([blob('README')])).toBe(true);
    expect(hasReadme([blob('Readme.txt')])).toBe(true);
  });

  it('does not accept a nested README as the repository README', () => {
    expect(hasReadme([blob('docs/README.md')])).toBe(false);
    expect(hasReadme([blob('skills/alpha/README.md')])).toBe(false);
  });

  it('does not accept a directory named README', () => {
    expect(hasReadme([{ path: 'README', mode: '040000', sha: 't', type: 'tree' }])).toBe(false);
  });

  it('rejects a repo with no README at all', () => {
    expect(hasReadme([blob('skills/alpha/SKILL.md')])).toBe(false);
    expect(hasReadme([])).toBe(false);
  });
});

describe('isRepoInternal', () => {
  it('flags a repo top-level .claude/skills tree', () => {
    expect(isRepoInternal('.claude/skills/deploy/SKILL.md')).toBe(true);
  });

  it('flags a nested .claude/skills tree', () => {
    expect(isRepoInternal('packages/api/.claude/skills/lint/SKILL.md')).toBe(true);
  });

  it('does not flag distributable skill directories', () => {
    expect(isRepoInternal('skills/deploy/SKILL.md')).toBe(false);
    expect(isRepoInternal('.claude/agents/reviewer.md')).toBe(false);
    expect(isRepoInternal('claude/skills/deploy/SKILL.md')).toBe(false);
    expect(isRepoInternal('my.claude/skills/x/SKILL.md')).toBe(false);
  });
});
