import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('typescript project', () => {
  it('typechecks with no errors', () => {
    const result = spawnSync('npm', ['run', '--silent', 'typecheck'], {
      cwd: root,
      encoding: 'utf8',
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    // tsc prints diagnostics on stdout; `npm run --silent` prints nothing at all
    // for a missing script, so the exit status is the assertion that catches that.
    expect(output).toBe('');
    expect(result.status).toBe(0);
  }, 180_000);
});
