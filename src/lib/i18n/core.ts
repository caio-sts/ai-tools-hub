import type { Lang } from '../../types.ts';

/**
 * Shared identity and layout chrome: the thesis, the header, navigation, the language switcher,
 * the theme control, the footer and the root language gateway. Strings only one surface prints
 * belong to that section's own namespace file in this directory — restating one here is a build
 * error.
 */
const en = {
  'site.name': 'AI Tools Hub',
  'site.thesis': 'A small, deep, auditable catalog of agent skills.',
  'site.support':
    'Every entry shows what it can do to your machine, where it came from, and why it is filed where it is.',
  'nav.label': 'Main navigation',
  'nav.home': 'Home',
  'nav.catalog': 'Catalog',
  'nav.methodology': 'Methodology',
  'nav.skipToResults': 'Skip to results',
  'lang.label': 'Language',
  'lang.en': 'English',
  'lang.pt': 'Portuguese (Brazil)',
  'theme.label': 'Theme',
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'footer.label': 'Footer navigation',
  'footer.note': 'Every entry links to the source file it was read from.',
  'gateway.heading': 'Choose your language',
  'gateway.body': 'You are being sent to the English site. Portuguese is one click away.',
} as const;

/** The annotation makes a missing or extra Portuguese key a compile error. */
const pt: Record<keyof typeof en, string> = {
  'site.name': 'AI Tools Hub',
  'site.thesis': 'Um catálogo pequeno, profundo e auditável de skills de agentes.',
  'site.support':
    'Cada entrada mostra o que pode fazer na sua máquina, de onde veio e por que está classificada onde está.',
  'nav.label': 'Navegação principal',
  'nav.home': 'Início',
  'nav.catalog': 'Catálogo',
  'nav.methodology': 'Metodologia',
  'nav.skipToResults': 'Ir para os resultados',
  'lang.label': 'Idioma',
  'lang.en': 'Inglês',
  'lang.pt': 'Português (Brasil)',
  'theme.label': 'Tema',
  'theme.system': 'Sistema',
  'theme.light': 'Claro',
  'theme.dark': 'Escuro',
  'footer.label': 'Navegação do rodapé',
  'footer.note': 'Cada entrada aponta para o arquivo de origem de onde foi lida.',
  'gateway.heading': 'Escolha seu idioma',
  'gateway.body': 'Você está sendo levado ao site em inglês. O português fica a um clique.',
};

const core: Record<Lang, Record<string, string>> = { en, pt };

export default core;
