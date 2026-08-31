import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import { isSymlink } from '../../scripts/harvest/enumerate.ts';

describe('isSymlink', () => {
  it('flags mode 120000 entries', () => {
    const link: TreeFile = {
      path: 'skills/mirror/SKILL.md',
      mode: '120000',
      sha: 'blob-a',
      type: 'blob',
    };
    expect(isSymlink(link)).toBe(true);
  });

  it('does not flag regular files, executables or trees', () => {
    expect(isSymlink({ path: 'a/SKILL.md', mode: '100644', sha: 's', type: 'blob' })).toBe(false);
    expect(isSymlink({ path: 'a/run.sh', mode: '100755', sha: 's', type: 'blob' })).toBe(false);
    expect(isSymlink({ path: 'a', mode: '040000', sha: 's', type: 'tree' })).toBe(false);
  });

  it('halves an inflated count: the sampled repo shape (458 links of 846 paths)', () => {
    const files: TreeFile[] = [];
    for (let i = 0; i < 388; i += 1) {
      files.push({ path: `skills/real${i}/SKILL.md`, mode: '100644', sha: `r${i}`, type: 'blob' });
    }
    for (let i = 0; i < 458; i += 1) {
      files.push({ path: `links/l${i}/SKILL.md`, mode: '120000', sha: `l${i}`, type: 'blob' });
    }
    expect(files).toHaveLength(846);
    expect(files.filter((f) => !isSymlink(f))).toHaveLength(388);
  });
});
