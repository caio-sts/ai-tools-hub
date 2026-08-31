import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const RUNBOOK = 'docs/operations/classification-session.md';

function doc(): string {
  if (!existsSync(RUNBOOK)) throw new Error(`Missing ${RUNBOOK}`);
  return readFileSync(RUNBOOK, 'utf8');
}

describe('classification session runbook', () => {
  it('has every required section', () => {
    const text = doc();
    for (const heading of [
      '## When it runs', '## Inputs', '## What the session produces',
      '## Procedure', '## Usage limits', '## Failure mode',
    ]) {
      expect(text, `missing heading: ${heading}`).toContain(heading);
    }
  });

  it('states that the session runs on the subscription, not an API key', () => {
    expect(doc()).toContain('subscription');
    expect(doc()).toContain('not a metered API key');
  });

  it('states that a human merges the PR', () => {
    const text = doc();
    expect(text).toContain('gh pr create');
    expect(text).toContain('A human merges');
  });

  it('warns that the first full pass may exceed usage limits and must be split', () => {
    const text = doc();
    expect(text).toContain('may exceed');
    expect(text).toContain('split it across several runs');
    expect(text).toContain('tens of entries');
  });

  it('documents the unclassified fallback', () => {
    expect(doc()).toContain('general');
    expect(doc()).toContain('stale-but-honest');
  });

  it('names the exact files the session reads and writes', () => {
    const text = doc();
    for (const file of ['data/skills.json', 'data/taxonomy.json', 'data/assignments.json', 'data/meta.json']) {
      expect(text, `missing file reference: ${file}`).toContain(file);
    }
  });

  it('documents assignments as a flat record keyed by skill id, never an envelope', () => {
    const text = doc();
    expect(text).toContain('Record<skillId, Assignment>');
    expect(text).not.toContain('"version": 1');
  });

  it('shows an assignment carrying exactly primary, also and tags', () => {
    const text = doc();
    expect(text).not.toContain('"securityRelevant"');
    expect(text).not.toContain('"descriptionPt"');
    expect(text).not.toContain('"longPt"');
  });

  it('requires classifiedAt to be bumped in the same PR', () => {
    expect(doc()).toContain('classifiedAt');
  });

  it('carries the PROTECTED list into the translation prompt', () => {
    const text = doc();
    expect(text).toContain('PROTECTED');
    expect(text).toContain('Supply Chain');
    expect(text).toContain('CI/CD');
  });

  it('requires the taxonomy validator to pass before the PR opens', () => {
    expect(doc()).toContain('scripts/validate-taxonomy.ts');
  });

  it('requires the rescue index to be regenerated when names change', () => {
    expect(doc()).toContain('scripts/build-rescue-index.ts');
  });

  it('forbids hand-editing the listing flag the harvest computes', () => {
    const text = doc();
    expect(text).toContain('**never** hand-edited');
    expect(text).toContain('per-subdomain cap');
  });
});
