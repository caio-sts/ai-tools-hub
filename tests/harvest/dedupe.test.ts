import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import { dedupeByBlobSha } from '../../scripts/harvest/enumerate.ts';

describe('dedupeByBlobSha', () => {
  it('keeps the first path for each blob sha', () => {
    const files: TreeFile[] = [
      { path: 'skills/a/SKILL.md', mode: '100644', sha: 'blob-1', type: 'blob' },
      { path: 'vendor/copy-of-a/SKILL.md', mode: '100644', sha: 'blob-1', type: 'blob' },
      { path: 'skills/b/SKILL.md', mode: '100644', sha: 'blob-2', type: 'blob' },
    ];

    expect(dedupeByBlobSha(files)).toEqual([
      { path: 'skills/a/SKILL.md', mode: '100644', sha: 'blob-1', type: 'blob' },
      { path: 'skills/b/SKILL.md', mode: '100644', sha: 'blob-2', type: 'blob' },
    ]);
  });

  it('is a no-op when every blob is distinct', () => {
    const files: TreeFile[] = [
      { path: 'a/SKILL.md', mode: '100644', sha: 'x', type: 'blob' },
      { path: 'b/SKILL.md', mode: '100644', sha: 'y', type: 'blob' },
    ];
    expect(dedupeByBlobSha(files)).toEqual(files);
  });

  it('handles an empty list', () => {
    expect(dedupeByBlobSha([])).toEqual([]);
  });

  it('collapses a repo that ships the same skill under many paths', () => {
    const files: TreeFile[] = Array.from({ length: 50 }, (_, i) => ({
      path: `copies/c${i}/SKILL.md`,
      mode: '100644',
      sha: 'same-blob',
      type: 'blob',
    }));
    expect(dedupeByBlobSha(files)).toHaveLength(1);
    expect(dedupeByBlobSha(files)[0].path).toBe('copies/c0/SKILL.md');
  });
});
