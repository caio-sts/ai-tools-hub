import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const service = readFileSync('ops/ai-tools-hub-harvest.service', 'utf8');
const timer = readFileSync('ops/ai-tools-hub-harvest.timer', 'utf8');
const install = readFileSync('ops/install-schedule.sh', 'utf8');

describe('the timer fires on the schedule §6.1 specifies', () => {
  it('starts 2 minutes after boot and repeats every 4 hours', () => {
    expect(timer).toContain('OnBootSec=2min');
    expect(timer).toContain('OnUnitActiveSec=4h');
  });

  it('carries Persistent=true, with the reason written next to it', () => {
    expect(timer).toContain('Persistent=true');
    expect(timer).toMatch(/do not "simplify" away/i);
  });

  it('is a user timer that installs into timers.target', () => {
    expect(timer).toContain('[Install]');
    expect(timer).toContain('WantedBy=timers.target');
    expect(timer).not.toContain('WantedBy=multi-user.target');
  });
});

describe('the service runs the harvest and publishes the result', () => {
  it('is a oneshot that runs the harvest npm script', () => {
    expect(service).toContain('Type=oneshot');
    expect(service).toContain('ExecStart=/usr/bin/env npm run harvest');
  });

  it('reads CATALOG_PAT from a file outside the repository', () => {
    expect(service).toContain('EnvironmentFile=%h/.config/ai-tools-hub/harvest.env');
    expect(service).not.toContain('CATALOG_PAT=');
  });

  it('rebases before pushing, because crawl.yml writes the same three files', () => {
    expect(service).toContain('git add data/skills.json data/collections.json data/meta.json');
    expect(service).toContain('git pull --rebase --autostash');
    expect(service).toContain('git push');
  });

  it('keeps the checkout path substitutable instead of hard-coded', () => {
    expect(service).toContain('WorkingDirectory=@REPO_DIR@');
    expect(install).toContain('s|@REPO_DIR@|$REPO_DIR|g');
  });
});

describe('install-schedule.sh installs both halves of the trigger', () => {
  it('is executable and fails fast', () => {
    expect(statSync('ops/install-schedule.sh').mode & 0o111).not.toBe(0);
    expect(install).toContain('set -euo pipefail');
  });

  it('installs the units as user units and enables the timer now', () => {
    expect(install).toContain('systemd/user');
    expect(install).toContain('systemctl --user daemon-reload');
    expect(install).toContain('systemctl --user enable --now ai-tools-hub-harvest.timer');
  });

  it('registers the Windows logon task idempotently', () => {
    expect(install).toContain('powershell.exe -NoProfile -Command');
    expect(install).toContain("-Execute 'wsl.exe'");
    expect(install).toContain('-AtLogOn');
    expect(install).toContain('Unregister-ScheduledTask');
    // "Unregister-ScheduledTask" does not contain "Register-ScheduledTask" — the capital R
    // differs — so this really does find the registration call, and it comes second.
    expect(install.indexOf('Unregister-ScheduledTask')).toBeLessThan(
      install.indexOf('Register-ScheduledTask -TaskName'),
    );
  });
});
