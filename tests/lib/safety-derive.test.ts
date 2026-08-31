import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import { deriveSafety } from '../../src/lib/safety.ts';

function file(path: string, mode = '100644', type = 'blob'): TreeFile {
  return { path, mode, sha: 'cafe1234', type };
}

describe('deriveSafety', () => {
  it('requires all three parameters, so frontmatter can never be dropped', () => {
    expect(deriveSafety.length).toBe(3);
  });

  it('derives the full surface from scripts and their contents', () => {
    const files = [
      file('skills/pdf/SKILL.md'),
      file('skills/pdf/scripts/fill_form.py'),
      file('skills/pdf/scripts/upload.sh', '100755'),
      file('skills/pdf/scripts/notes.md'),
      file('skills/pdf/scripts/linked.py', '120000'),
    ];
    const contents = new Map([
      ['skills/pdf/scripts/fill_form.py', 'import pypdf\nwith open(path) as fh:\n    pass\n'],
      ['skills/pdf/scripts/upload.sh', 'curl -X POST "$UPLOAD_TOKEN" https://example.com/api\n'],
    ]);

    expect(deriveSafety(files, contents, { name: 'pdf', 'allowed-tools': ['Bash', 'Read'] })).toEqual({
      executesCode: true,
      scriptCount: 2,
      languages: ['python', 'shell'],
      network: true,
      readsEnv: true,
      declaredTools: ['Bash', 'Read'],
    });
  });

  it('reports no execution for a documentation-only skill', () => {
    expect(
      deriveSafety([file('skills/style/SKILL.md'), file('skills/style/reference.md')], new Map(), {}),
    ).toEqual({
      executesCode: false,
      scriptCount: 0,
      languages: [],
      network: false,
      readsEnv: false,
      declaredTools: null,
    });
  });

  it('counts an executable file with no recognised extension without inventing a language', () => {
    const safety = deriveSafety(
      [file('skills/x/scripts/run', '100755'), file('skills/x/scripts/build.py')],
      new Map([['skills/x/scripts/build.py', 'print("hello")']]),
      {},
    );
    expect(safety.scriptCount).toBe(2);
    expect(safety.languages).toEqual(['python']);
    expect(safety.executesCode).toBe(true);
  });

  it('stays silent about network and env when script contents were not fetched', () => {
    const safety = deriveSafety([file('skills/x/scripts/a.py')], new Map(), {});
    expect(safety).toEqual({
      executesCode: true,
      scriptCount: 1,
      languages: ['python'],
      network: false,
      readsEnv: false,
      declaredTools: null,
    });
  });

  it('sorts and dedupes languages deterministically', () => {
    const safety = deriveSafety(
      [
        file('s/scripts/z.sh'),
        file('s/scripts/a.py'),
        file('s/scripts/b.py'),
        file('s/scripts/c.mjs'),
      ],
      new Map(),
      {},
    );
    expect(safety.languages).toEqual(['javascript', 'python', 'shell']);
    expect(safety.scriptCount).toBe(4);
  });

  it('yields declaredTools null when the frontmatter declares no allowed-tools', () => {
    expect(deriveSafety([file('s/scripts/a.py')], new Map(), { name: 'x' }).declaredTools).toBeNull();
  });
});
