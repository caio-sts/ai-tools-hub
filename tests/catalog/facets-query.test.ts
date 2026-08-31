import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SORT,
  PAGE_SIZE,
  SORT_KEYS,
  activeChips,
  isSortKey,
  parseQuery,
  removeFilter,
  serializeQuery,
  toggleFilter,
} from '../../src/lib/facets.ts';

const DEFAULT_QUERY = { filters: {}, q: '', sort: 'score' as const, page: 1 };

describe('sort vocabulary', () => {
  it('offers exactly five sorts with score as the default', () => {
    expect([...SORT_KEYS]).toEqual(['score', 'stars', 'forks', 'newest', 'updated']);
    expect(DEFAULT_SORT).toBe('score');
  });

  it('fits a 6-column grid four rows deep', () => {
    expect(PAGE_SIZE).toBe(24);
  });

  it('guards unknown sort strings', () => {
    expect(isSortKey('stars')).toBe(true);
    expect(isSortKey('relevance')).toBe(false);
  });
});

describe('parseQuery', () => {
  it('returns the default state for an empty search', () => {
    expect(parseQuery('')).toEqual(DEFAULT_QUERY);
  });

  it('splits comma-separated values and decodes slugs', () => {
    const q = parseQuery('?subdomain=security%2Fsupply-chain,security%2Fcicd-pipeline');
    expect(q.filters.subdomain).toEqual(['security/cicd-pipeline', 'security/supply-chain']);
  });

  it('accepts a search string without the leading question mark', () => {
    expect(parseQuery('risk=no-code-execution').filters.risk).toEqual(['no-code-execution']);
  });

  it('ignores unknown parameters', () => {
    expect(parseQuery('?colour=orange')).toEqual(DEFAULT_QUERY);
  });

  it('falls back to the default sort for an unknown sort', () => {
    expect(parseQuery('?sort=relevance').sort).toBe('score');
  });

  it('clamps a junk or non-positive page to 1', () => {
    expect(parseQuery('?page=0').page).toBe(1);
    expect(parseQuery('?page=abc').page).toBe(1);
    expect(parseQuery('?page=7').page).toBe(7);
  });

  it('de-duplicates repeated values', () => {
    expect(parseQuery('?runtime=claude,claude').filters.runtime).toEqual(['claude']);
  });

  it('decodes and trims the text term', () => {
    expect(parseQuery('?q=kube%20audit').q).toBe('kube audit');
    expect(parseQuery('?q=%20%20').q).toBe('');
  });
});

describe('serializeQuery', () => {
  it('emits nothing for the default state', () => {
    expect(serializeQuery(DEFAULT_QUERY)).toBe('');
  });

  it('omits the default sort and page 1', () => {
    expect(serializeQuery({ ...DEFAULT_QUERY, filters: { risk: ['network'] } })).toBe('?risk=network');
  });

  it('puts the text term first, because it is what the reader typed', () => {
    expect(serializeQuery({ ...DEFAULT_QUERY, q: 'kube audit', filters: { risk: ['network'] } }))
      .toBe('?q=kube%20audit&risk=network');
  });

  it('percent-encodes slugs but keeps the comma readable', () => {
    expect(
      serializeQuery({
        filters: { subdomain: ['security/supply-chain', 'devops-infra/general'] },
        q: '',
        sort: 'stars',
        page: 3,
      }),
    ).toBe('?subdomain=devops-infra%2Fgeneral,security%2Fsupply-chain&sort=stars&page=3');
  });

  it('orders keys canonically regardless of insertion order', () => {
    const a = serializeQuery({ ...DEFAULT_QUERY, filters: { license: ['MIT'], risk: ['network'] } });
    const b = serializeQuery({ ...DEFAULT_QUERY, filters: { risk: ['network'], license: ['MIT'] } });
    expect(a).toBe(b);
    expect(a).toBe('?risk=network&license=MIT');
  });

  it('round-trips through parseQuery', () => {
    const q = {
      filters: { subdomain: ['security/supply-chain'], runtime: ['claude'] },
      q: 'lockfile',
      sort: 'updated' as const,
      page: 4,
    };
    expect(parseQuery(serializeQuery(q))).toEqual(q);
  });
});

describe('toggleFilter and removeFilter', () => {
  it('adds a value without mutating the input', () => {
    const before = {};
    expect(toggleFilter(before, 'risk', 'network')).toEqual({ risk: ['network'] });
    expect(before).toEqual({});
  });

  it('removes a value that was already checked', () => {
    expect(toggleFilter({ risk: ['network', 'reads-env'] }, 'risk', 'network')).toEqual({ risk: ['reads-env'] });
  });

  it('drops the key entirely when its last value goes', () => {
    expect(toggleFilter({ risk: ['network'] }, 'risk', 'network')).toEqual({});
  });

  it('keeps values sorted so URLs are stable', () => {
    expect(toggleFilter({ runtime: ['generic'] }, 'runtime', 'claude').runtime).toEqual(['claude', 'generic']);
  });

  it('removeFilter is idempotent for an absent value', () => {
    expect(removeFilter({ risk: ['network'] }, 'risk', 'reads-env')).toEqual({ risk: ['network'] });
  });
});

describe('activeChips', () => {
  it('flattens the state in canonical key order, one chip per value', () => {
    expect(activeChips({ license: ['MIT'], risk: ['network', 'reads-env'] })).toEqual([
      { key: 'risk', value: 'network' },
      { key: 'risk', value: 'reads-env' },
      { key: 'license', value: 'MIT' },
    ]);
  });

  it('is empty for an empty state', () => {
    expect(activeChips({})).toEqual([]);
  });
});
