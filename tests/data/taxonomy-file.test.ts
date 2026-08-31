import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';

const TAXONOMY_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/taxonomy.json');
const tax = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf8')) as Taxonomy;

const SECURITY_CHILDREN = [
  'security/code-application', 'security/secrets-credentials', 'security/supply-chain',
  'security/iac-config', 'security/cloud-permissions', 'security/containers-kubernetes',
  'security/cicd-pipeline', 'security/identity-access', 'security/data-protection',
  'security/offensive-testing', 'security/detection-forensics', 'security/compliance-grc',
  'security/ai-agent-security', 'security/threat-modeling', 'security/general',
];

const OTHER_DOMAINS = [
  'coding-software', 'devops-infra', 'data-analytics', 'ai-agent-eng', 'docs-formats',
  'writing-docs', 'research-knowledge', 'design-creative', 'business-product',
  'productivity', 'agent-authoring', 'vertical-domain',
];

describe('data/taxonomy.json', () => {
  it('has the 13 top-level domains with security first', () => {
    expect(tax.domains.map((d) => d.slug)).toEqual(['security', ...OTHER_DOMAINS]);
  });

  it('expands security into exactly the 15 subdomains', () => {
    const security = tax.domains.find((d) => d.slug === 'security');
    expect(security?.children?.map((c) => c.slug)).toEqual(SECURITY_CHILDREN);
  });

  it('names every node in both locales', () => {
    for (const domain of tax.domains) {
      for (const node of [domain, ...(domain.children ?? [])]) {
        expect(node.name.en.length, `${node.slug} en`).toBeGreaterThan(0);
        expect(node.name.pt.length, `${node.slug} pt`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps CI/CD and Supply Chain verbatim in pt-BR', () => {
    const security = tax.domains.find((d) => d.slug === 'security');
    const cicd = security?.children?.find((c) => c.slug === 'security/cicd-pipeline');
    const supply = security?.children?.find((c) => c.slug === 'security/supply-chain');
    expect(cicd?.name.pt).toBe('CI/CD e Pipeline');
    expect(supply?.name.pt).toBe('Supply Chain e Dependências');
  });

  it('carries frameworkRefs on every security subdomain except general', () => {
    const security = tax.domains.find((d) => d.slug === 'security');
    for (const child of security?.children ?? []) {
      if (child.slug === 'security/general') continue;
      expect(child.frameworkRefs?.length, child.slug).toBeGreaterThan(0);
    }
  });

  it('declares the governance lists from the spec', () => {
    expect(tax.protected).toEqual(['CI/CD', 'Kubernetes', 'Supply Chain', 'IaC', 'SBOM', 'SLSA', 'OWASP', 'MCP', 'DAST', 'SAST', 'IAM']);
    expect(tax.aliases).toEqual({
      grc: 'compliance-grc', k8s: 'containers-kubernetes', appsec: 'code-application',
      cspm: 'cloud-permissions', ciem: 'cloud-permissions', posture: 'cloud-permissions',
      ir: 'detection-forensics', siem: 'detection-forensics', sca: 'supply-chain',
    });
    expect(tax.minimumMass).toBe(5);
  });
});
