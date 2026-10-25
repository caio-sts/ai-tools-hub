import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Runs each alarm's shell as written in the YAML, against a stub gh that records its calls: the
// structural tests prove the text, this proves what a failing run would actually send.
interface Step {
  run?: string;
}

const crawl = parse(readFileSync('.github/workflows/crawl.yml', 'utf8')).jobs.harvest.steps as Step[];
const deploy = parse(readFileSync('.github/workflows/deploy.yml', 'utf8')).jobs.report.steps as Step[];
const runOf = (steps: Step[], marker: string): string => steps.find((step) => step.run?.includes(marker))!.run!;

const ALARMS = {
  'P1: crawl failed': runOf(crawl, 'P1: crawl failed'),
  'P2: skills.json near the 100 MiB file limit': runOf(crawl, 'P2: skills.json'),
  'P1: deploy failed': runOf(deploy, 'P1: deploy failed'),
};

function runAlarm(script: string, openIssue: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'alarm-'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'skills.json'), '');
  truncateSync(join(dir, 'data', 'skills.json'), 85 * 1024 * 1024);
  const gh = join(dir, 'bin', 'gh');
  writeFileSync(gh, '#!/bin/bash\necho "$*" >> "$GH_LOG"\n[ "$1 $2" = "issue list" ] && [ -n "$FAKE_OPEN" ] && echo "$FAKE_OPEN"\nexit 0\n');
  chmodSync(gh, 0o755);
  const log = join(dir, 'gh.log');
  writeFileSync(log, '');
  execFileSync('bash', ['-e', '-c', script], {
    cwd: dir,
    env: {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      GH_LOG: log,
      FAKE_OPEN: openIssue,
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_REPOSITORY_OWNER: 'owner',
      GITHUB_RUN_ID: '1',
    },
  });
  return readFileSync(log, 'utf8').trim().split('\n').filter((call) => !call.startsWith('issue list'));
}

describe('alarm shells, run against a stub gh (spec §13)', () => {
  for (const [title, script] of Object.entries(ALARMS)) {
    it(`${title}: opens one issue that mentions the owner`, () => {
      const calls = runAlarm(script, '');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatch(new RegExp(`^issue create --title ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --body @owner .*Run: https://github.com/owner/repo/actions/runs/1$`));
    });

    it(`${title}: comments on the open issue, mentioning the owner again`, () => {
      const calls = runAlarm(script, '7');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatch(/^issue comment 7 --body @owner .*Run: https:\/\/github.com\/owner\/repo\/actions\/runs\/1$/);
    });
  }
});
