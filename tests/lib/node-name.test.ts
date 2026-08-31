import { describe, expect, it } from 'vitest';
import { nodeName } from '../../src/lib/taxonomy.ts';

describe('nodeName', () => {
  it('localises a domain', () => {
    expect(nodeName('security', 'en')).toBe('Security');
    expect(nodeName('security', 'pt')).toBe('Segurança');
  });

  it('localises a child by its full slug', () => {
    expect(nodeName('security/supply-chain', 'en')).toBe('Supply Chain & Dependencies');
    expect(nodeName('security/supply-chain', 'pt')).toBe('Supply Chain e Dependências');
  });

  it('localises the named overflow leaf of a thin domain', () => {
    expect(nodeName('productivity/general', 'en')).toBe('General / Other');
    expect(nodeName('productivity/general', 'pt')).toBe('Geral / Outros');
  });

  it('throws loudly on an unknown slug rather than returning a blank label', () => {
    expect(() => nodeName('security/does-not-exist', 'en')).toThrow('nodeName: unknown taxonomy slug "security/does-not-exist"');
  });
});
