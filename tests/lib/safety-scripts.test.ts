import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import {
  EXECUTABLE_MODE,
  RUNTIME_ORDER,
  SYMLINK_MODE,
  extensionOf,
  isScriptEntry,
  languageOf,
  scriptFilesFor,
  skillDirOf,
} from '../../src/lib/safety.ts';

function file(path: string, mode = '100644', type = 'blob'): TreeFile {
  return { path, mode, sha: 'deadbeef', type };
}

const TREE: TreeFile[] = [
  file('skills/pdf/SKILL.md'),
  file('skills/pdf/README.md'),
  file('skills/pdf/scripts/fill_form.py'),
  file('skills/pdf/scripts/helpers/split.sh', EXECUTABLE_MODE),
  file('skills/pdf/scripts/notes.md'),
  file('skills/pdf/scripts/run', EXECUTABLE_MODE),
  file('skills/pdf/scripts/linked.py', SYMLINK_MODE),
  file('skills/pdf/scripts/vendor', '040000', 'tree'),
  file('skills/docx/scripts/convert.py'),
  file('scripts/build.py'),
];

describe('scriptFilesFor', () => {
  it('takes the tree first and the skill path second', () => {
    expect(scriptFilesFor.length).toBe(2);
  });

  it('selects only executable files under this skill’s scripts directory', () => {
    const paths = scriptFilesFor(TREE, 'skills/pdf/SKILL.md').map((f) => f.path);
    expect(paths).toEqual([
      'skills/pdf/scripts/fill_form.py',
      'skills/pdf/scripts/helpers/split.sh',
      'skills/pdf/scripts/run',
    ]);
  });

  it('excludes symlinks, trees, docs and other skills', () => {
    const paths = scriptFilesFor(TREE, 'skills/pdf/SKILL.md').map((f) => f.path);
    expect(paths).not.toContain('skills/pdf/scripts/linked.py');
    expect(paths).not.toContain('skills/pdf/scripts/notes.md');
    expect(paths).not.toContain('skills/pdf/scripts/vendor');
    expect(paths).not.toContain('skills/docx/scripts/convert.py');
    expect(paths).not.toContain('scripts/build.py');
  });

  it('handles a SKILL.md at the repo root', () => {
    expect(skillDirOf('SKILL.md')).toBe('');
    expect(skillDirOf('skills/pdf/SKILL.md')).toBe('skills/pdf');
    expect(scriptFilesFor(TREE, 'SKILL.md').map((f) => f.path)).toEqual(['scripts/build.py']);
  });

  it('returns an empty list for a skill with no scripts directory', () => {
    expect(scriptFilesFor([file('a/SKILL.md'), file('a/reference.md')], 'a/SKILL.md')).toEqual([]);
  });
});

describe('languageOf', () => {
  it('maps known script extensions', () => {
    expect(languageOf('a/scripts/x.py')).toBe('python');
    expect(languageOf('a/scripts/x.sh')).toBe('shell');
    expect(languageOf('a/scripts/x.bash')).toBe('shell');
    expect(languageOf('a/scripts/x.mjs')).toBe('javascript');
    expect(languageOf('a/scripts/x.ts')).toBe('typescript');
    expect(languageOf('a/scripts/x.PY')).toBe('python');
  });

  it('returns null for a file with no recognised language', () => {
    expect(languageOf('a/scripts/run')).toBeNull();
    expect(languageOf('a/scripts/notes.md')).toBeNull();
  });

  it('extracts extensions', () => {
    expect(extensionOf('a/b/c.tar.gz')).toBe('.gz');
    expect(extensionOf('a/b/run')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
  });
});

describe('isScriptEntry', () => {
  it('accepts a script blob under any scripts/ segment', () => {
    expect(isScriptEntry(file('skills/pdf/scripts/x.py'))).toBe(true);
    expect(isScriptEntry(file('scripts/x.py'))).toBe(true);
  });

  it('rejects symlinks, non-blobs and files outside scripts/', () => {
    expect(isScriptEntry(file('skills/pdf/scripts/x.py', SYMLINK_MODE))).toBe(false);
    expect(isScriptEntry(file('skills/pdf/scripts/x.py', '040000', 'tree'))).toBe(false);
    expect(isScriptEntry(file('skills/pdf/x.py'))).toBe(false);
  });
});

describe('RUNTIME_ORDER', () => {
  it('is the single canonical ordering, declared in the UI-safe module', () => {
    expect(RUNTIME_ORDER).toEqual(['claude', 'openclaw', 'codex', 'cursor', 'generic']);
  });

  it('is not alphabetical', () => {
    expect([...RUNTIME_ORDER].sort()).not.toEqual(RUNTIME_ORDER);
  });
});
