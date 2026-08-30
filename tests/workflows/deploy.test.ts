import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface Job {
  'runs-on': string;
  needs?: string;
  steps?: Step[];
}

interface Workflow {
  name: string;
  // The `yaml` package is YAML 1.2, which keeps `on` a plain string key
  // (YAML 1.1 parsers fold it into boolean true).
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: Record<string, unknown>;
  jobs: Record<string, Job>;
}

const file = fileURLToPath(new URL('../../.github/workflows/deploy.yml', import.meta.url));
const workflow = parse(readFileSync(file, 'utf8')) as Workflow;
const buildSteps = workflow.jobs.build.steps ?? [];

function stepUsing(prefix: string): Step {
  const step = buildSteps.find((candidate) => (candidate.uses ?? '').startsWith(prefix));
  if (step === undefined) {
    throw new Error(`no build step uses ${prefix}`);
  }
  return step;
}

describe('deploy.yml', () => {
  it('runs on pushes to the default branch and on demand', () => {
    expect(Object.keys(workflow.on)).toEqual(
      expect.arrayContaining(['push', 'workflow_dispatch']),
    );
    expect((workflow.on.push as { branches: string[] }).branches).toEqual(['main', 'master']);
  });

  it('requests exactly the permissions an OIDC Pages deploy needs', () => {
    expect(workflow.permissions).toEqual({
      contents: 'read',
      pages: 'write',
      'id-token': 'write',
    });
  });

  it('queues deployments instead of cancelling them', () => {
    expect(workflow.concurrency).toEqual({ group: 'pages', 'cancel-in-progress': false });
  });

  it('uploads hidden files so _astro/ survives', () => {
    const upload = stepUsing('actions/upload-pages-artifact@');
    expect(upload.uses).toBe('actions/upload-pages-artifact@v5.0.0');
    expect(upload.with).toEqual({ path: './dist', 'include-hidden-files': true });
  });

  it('pins every action to the agreed version', () => {
    expect(stepUsing('actions/checkout@').uses).toBe('actions/checkout@v5');
    expect(stepUsing('actions/setup-node@').uses).toBe('actions/setup-node@v5');
    expect(stepUsing('actions/configure-pages@').uses).toBe('actions/configure-pages@v6.0.0');
  });

  it('builds on a Node the package engines allow', () => {
    expect(stepUsing('actions/setup-node@').with).toEqual({
      'node-version': '24',
      cache: 'npm',
    });
  });

  it('installs from the committed lockfile and runs the astro build', () => {
    expect(buildSteps.some((step) => step.run === 'npm ci')).toBe(true);
    expect(buildSteps.some((step) => step.run === 'npm run build')).toBe(true);
  });

  it('deploys from a second job gated on the build', () => {
    const deploy = workflow.jobs.deploy;
    expect(deploy.needs).toBe('build');
    expect((deploy.steps ?? [])[0]?.uses).toBe('actions/deploy-pages@v5.0.0');
  });
});
