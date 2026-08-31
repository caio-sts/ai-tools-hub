import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import { filterSkillFiles } from '../../scripts/harvest/enumerate.ts';

describe('filterSkillFiles', () => {
  it('keeps only distributable, non-symlinked, deduped SKILL.md blobs', () => {
    const tree: TreeFile[] = [
      { path: 'skills', mode: '040000', sha: 'tree-1', type: 'tree' },
      { path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' },
      { path: 'skills/beta/SKILL.md', mode: '120000', sha: 'blob-b', type: 'blob' },
      { path: 'mirror/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' },
      { path: '.claude/skills/internal/SKILL.md', mode: '100644', sha: 'blob-c', type: 'blob' },
      { path: 'skills/gamma/README.md', mode: '100644', sha: 'blob-d', type: 'blob' },
      { path: 'skills/delta/SKILL.md', mode: '100644', sha: 'blob-e', type: 'blob' },
    ];

    expect(filterSkillFiles(tree)).toEqual([
      { path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' },
      { path: 'skills/delta/SKILL.md', mode: '100644', sha: 'blob-e', type: 'blob' },
    ]);
  });

  it('returns an empty list for a repo with no skills', () => {
    expect(
      filterSkillFiles([{ path: 'README.md', mode: '100644', sha: 'r', type: 'blob' }]),
    ).toEqual([]);
  });

  it('does not let a deduped internal copy steal the slot of a real skill', () => {
    const tree: TreeFile[] = [
      { path: '.claude/skills/x/SKILL.md', mode: '100644', sha: 'shared', type: 'blob' },
      { path: 'skills/x/SKILL.md', mode: '100644', sha: 'shared', type: 'blob' },
    ];
    expect(filterSkillFiles(tree)).toEqual([
      { path: 'skills/x/SKILL.md', mode: '100644', sha: 'shared', type: 'blob' },
    ]);
  });
});
