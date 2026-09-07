import type { Lang } from '../../types.ts';

const en = {
  'skill.breadcrumb': 'Breadcrumb',
  'skill.home': 'Home',
  'skill.rankLabel': 'Rank',
  'skill.scoreLabel': 'Score',
  'skill.runtimes': 'Runtime compatibility',
  'skill.supported': 'supported',
  'skill.unsupported': 'not supported',
  'skill.safetyTitle': 'Derived safety signals',
  'skill.executes': 'Executes code',
  'skill.script': 'script',
  'skill.scripts': 'scripts',
  // The key asks and the value answers: "Environment: No environment reads" said environment
  // twice and wrapped on every card back when a card was 198px. The hazard answers stay sentences
  // on purpose (B4.5: two states, no green) — the inert state is the quiet one.
  // The key names the axis it measures, not just its subject: "Environment" left the reader to
  // guess whether the answer was about reading it, writing it or needing it.
  'skill.noScripts': 'No',
  'skill.network': 'Uses network',
  'skill.networkYes': 'Makes network calls',
  'skill.networkNo': 'No',
  'skill.env': 'Reads env vars',
  'skill.envYes': 'Reads environment variables',
  'skill.envNo': 'No',
  'skill.tools': 'Declared tools',
  'skill.toolsNotDeclared': 'None',
  'skill.source': 'Source',
  'skill.stars': 'Stars',
  'skill.forks': 'Forks',
  'skill.picked': 'Picked',
  'skill.updated': 'Updated',
  'skill.scoreBreakdown': 'Score breakdown',
  // The chip states a taxonomy relation, so it says which one. Without a label a bare leaf name
  // reads as "this card's category", which is wrong the moment the list was filtered by another.
  'skill.filedUnder': 'Filed under',
  'skill.alsoIn': 'Also in',
  'skill.adoption': 'Adoption',
  'skill.maintenance': 'Maintenance',
  'skill.provenanceScore': 'Provenance',
  'skill.completeness': 'Completeness',
  'skill.total': 'Total',
  'skill.provenance': 'Provenance',
  'skill.officialFile': 'Official file',
  'skill.install': 'Install',
  'skill.copy': 'Copy',
  'skill.copied': 'Copied',
  'skill.license': 'License',
  'skill.licenseNotDeclared': 'Not declared',
  'skill.bodySource': 'Full text is fetched from the source repository.',
  'skill.bodyUnavailable': 'The full text could not be fetched. The description above is what we indexed.',
  'skill.machineTranslated': 'Machine-translated.',
  'skill.seeOriginal': 'See original',
} as const;

const pt: Record<keyof typeof en, string> = {
  'skill.breadcrumb': 'Trilha de navegação',
  'skill.home': 'Início',
  'skill.rankLabel': 'Posição',
  'skill.scoreLabel': 'Pontuação',
  'skill.runtimes': 'Compatibilidade de runtime',
  'skill.supported': 'compatível',
  'skill.unsupported': 'não compatível',
  'skill.safetyTitle': 'Sinais de risco derivados',
  'skill.executes': 'Executa código',
  'skill.script': 'script',
  'skill.scripts': 'scripts',
  'skill.noScripts': 'Não',
  'skill.network': 'Usa rede',
  'skill.networkYes': 'Faz chamadas de rede',
  'skill.networkNo': 'Não',
  'skill.env': 'Lê variáveis',
  'skill.envYes': 'Lê variáveis de ambiente',
  'skill.envNo': 'Não',
  // Shortened to "Ferramentas" while the key shared a 183px line with its value. The row is
  // full-width now and the key owns it, so the qualifier fits again — and it is the one this row
  // cannot do without: we read what a skill declares, and only ~9% declare anything at all.
  'skill.tools': 'Ferramentas declaradas',
  'skill.toolsNotDeclared': 'Nenhuma',
  'skill.source': 'Origem',
  'skill.stars': 'Estrelas',
  'skill.forks': 'Forks',
  'skill.picked': 'Coletado',
  'skill.updated': 'Atualizado',
  'skill.scoreBreakdown': 'Composição da pontuação',
  'skill.filedUnder': 'Arquivado em',
  'skill.alsoIn': 'Também em',
  'skill.adoption': 'Adoção',
  'skill.maintenance': 'Manutenção',
  'skill.provenanceScore': 'Procedência',
  'skill.completeness': 'Completude',
  'skill.total': 'Total',
  'skill.provenance': 'Procedência',
  'skill.officialFile': 'Arquivo oficial',
  'skill.install': 'Instalar',
  'skill.copy': 'Copiar',
  'skill.copied': 'Copiado',
  'skill.license': 'Licença',
  'skill.licenseNotDeclared': 'Não declarada',
  'skill.bodySource': 'O texto completo é buscado no repositório de origem.',
  'skill.bodyUnavailable': 'Não foi possível buscar o texto completo. A descrição acima é a que indexamos.',
  'skill.machineTranslated': 'Tradução automática.',
  'skill.seeOriginal': 'Ver original',
};

export type SkillKey = keyof typeof en;

const strings: Record<Lang, Record<SkillKey, string>> = { en, pt };
export default strings;
