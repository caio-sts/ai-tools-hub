import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkProtectedParity, protectedTermPattern } from '../../scripts/validate-taxonomy.ts';

function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

describe('check 7 - protected-term parity', () => {
  it('passes on the committed taxonomy', () => {
    expect(checkProtectedParity(loadTaxonomy())).toEqual({ name: '7 protected-term parity', ok: true, errors: [] });
  });

  it('catches CI/CD drifting to Integração Contínua in pt-BR', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const node = security!.children!.find((c) => c.slug === 'security/cicd-pipeline');
    node!.name.pt = 'Integração Contínua e Pipeline';
    const result = checkProtectedParity(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('node "security/cicd-pipeline": protected term "CI/CD" is in en ("CI/CD & Pipeline") but not in pt ("Integração Contínua e Pipeline")');
  });

  it('catches Supply Chain drifting to cadeia de suprimentos', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const node = security!.children!.find((c) => c.slug === 'security/supply-chain');
    node!.name.pt = 'Cadeia de Suprimentos e Dependências';
    const result = checkProtectedParity(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('protected term "Supply Chain" is in en');
  });

  it('catches a term added in pt-BR but not in English', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const node = security!.children!.find((c) => c.slug === 'security/containers-kubernetes');
    node!.name.en = 'Containers & Orchestration';
    const result = checkProtectedParity(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('protected term "Kubernetes" is in pt');
  });
});

describe('protectedTermPattern', () => {
  it('matches whole terms only, ignoring case', () => {
    expect(protectedTermPattern('IaC').test('Infrastructure as Code')).toBe(false);
    expect(protectedTermPattern('IAM').test('Identidade e Acesso')).toBe(false);
    expect(protectedTermPattern('SAST').test('SAST review')).toBe(true);
    expect(protectedTermPattern('MCP').test('MCPServer')).toBe(false);
  });

  it('handles the slash in CI/CD', () => {
    expect(protectedTermPattern('CI/CD').test('CI/CD & Pipeline')).toBe(true);
    expect(protectedTermPattern('CI/CD').test('CI e CD')).toBe(false);
  });
});
