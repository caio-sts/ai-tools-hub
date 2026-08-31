import type { Lang } from '../../types.ts';

/**
 * Home-page strings, plus the four stat labels this namespace owns. Chrome that other surfaces
 * also show — site.thesis, site.support, nav.* — belongs to src/lib/i18n/core.ts and is consumed
 * through t(); it is never restated here. Keys are fully qualified so index.ts merges by spread.
 */
const en = {
  'home.description':
    'A small, deep, auditable catalog of agent skills: the security domain fully expanded, every other domain present and honestly thin.',
  'home.securityLead':
    'Every security subdomain, expanded — including the ones nothing has been filed under yet.',
  'home.otherHeading': 'Other domains',
  'home.otherLead':
    'Present, and honestly thin. A domain link opens the catalog filtered to everything beneath it.',
  'home.filterLabel': 'Find a group',
  'home.filterPlaceholder': 'domain, subdomain or abbreviation',
  'home.filterClear': 'Clear the group filter',
  'home.filterCount': 'Groups shown',
  'home.filterEmpty': 'No group matches that. Clear the filter to see all of them.',
  'home.nodeThin': 'below minimum mass',
  'home.nodeEmpty': 'no entries yet',
  // No day count and no cadence in the prose: STALE_DAYS (src/lib/format.ts, B1) is the only
  // place the threshold is written, and the schedule (a local systemd timer every 4h, with the
  // weekly Action as fallback — §6.1) lives in ops/, not in a string.
  'home.staleNote': 'this figure is stale — the refresh may be stuck',
  'stats.skills': 'Skills indexed',
  'stats.sources': 'Sources',
  'stats.domains': 'Domains',
  'stats.lastRefresh': 'Last refresh',
} as const;

/** The annotation makes a missing or extra pt-BR key a compile error, not a silent English leak. */
const pt: Record<keyof typeof en, string> = {
  'home.description':
    'Um catálogo pequeno, profundo e auditável de skills de agentes: o domínio de segurança totalmente expandido, os demais presentes e honestamente rasos.',
  'home.securityLead':
    'Todos os subdomínios de segurança, expandidos — inclusive aqueles onde nada foi classificado ainda.',
  'home.otherHeading': 'Outros domínios',
  'home.otherLead':
    'Presentes, e honestamente rasos. O link de um domínio abre o catálogo filtrado por tudo que está abaixo dele.',
  'home.filterLabel': 'Encontrar um grupo',
  'home.filterPlaceholder': 'domínio, subdomínio ou sigla',
  'home.filterClear': 'Limpar o filtro de grupos',
  'home.filterCount': 'Grupos exibidos',
  'home.filterEmpty': 'Nenhum grupo corresponde a isso. Limpe o filtro para ver todos.',
  'home.nodeThin': 'abaixo da massa mínima',
  'home.nodeEmpty': 'sem entradas ainda',
  'home.staleNote': 'este número está defasado — a atualização pode ter parado',
  'stats.skills': 'Skills indexadas',
  'stats.sources': 'Fontes',
  'stats.domains': 'Domínios',
  'stats.lastRefresh': 'Última atualização',
};

const home: Record<Lang, Record<string, string>> = { en, pt };

export default home;
