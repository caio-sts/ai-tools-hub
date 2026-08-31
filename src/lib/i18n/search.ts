import type { Lang } from '../../types.ts';

/**
 * Search-box chrome and the pipeline status footer. Hand-written in both locales (spec §8).
 * This module owns search.label and search.placeholder; B3's SearchBox only calls t().
 */
const en = {
  'search.suggestions': 'Suggestions',
  'search.didYouMean': 'Did you mean',
  'search.noResults': 'No results',
  'search.resultOne': 'result',
  'search.resultMany': 'results',
  'status.heading': 'Pipeline status',
  'status.crawled': 'Crawled',
  'status.classified': 'Classified',
  'status.lag': 'Classification lag',
  'status.neverRun': 'never run',
  'status.unknown': 'unknown',
  'status.queued': 'entries queued unclassified',
} as const;

const pt: Record<keyof typeof en, string> = {
  'search.suggestions': 'Sugestões',
  'search.didYouMean': 'Você quis dizer',
  'search.noResults': 'Nenhum resultado',
  'search.resultOne': 'resultado',
  'search.resultMany': 'resultados',
  'status.heading': 'Estado do pipeline',
  'status.crawled': 'Coleta',
  'status.classified': 'Classificação',
  'status.lag': 'Atraso da classificação',
  'status.neverRun': 'nunca executada',
  'status.unknown': 'desconhecido',
  'status.queued': 'entradas aguardando classificação',
};

const search: Record<Lang, Record<string, string>> = { en, pt };
export default search;
