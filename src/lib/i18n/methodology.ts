import type { Lang } from '../../types.ts';

/** Spec §10.6. Our own editorial text, hand-written in both locales — never machine-translated. */
const en = {
  'methodology.title': 'Methodology',
  'methodology.intro':
    'Every rule this catalog applies is written down here. The order is reproducible: run the formula yourself and you get the same ranking.',

  'methodology.score.heading': 'Score',
  'methodology.score.formulaLabel': 'The formula',
  'methodology.score.adoption':
    'log10 of the repository star count, normalised. This is a repo-level signal and is labelled as such wherever it appears.',
  'methodology.score.maintenance':
    'Exponential decay on days since the last commit that touched this skill path, with a 90-day half-life. Per skill, not per repo.',
  'methodology.score.provenance':
    'Listed in a curated marketplace adds 12, an organisation account adds 8, a declared license adds 5.',
  'methodology.score.completeness':
    'Spec-conformant frontmatter adds 9, a resolvable license adds 6, a real description adds 5.',
  'methodology.score.balance':
    'Per-skill signals outweigh repo-level ones, 55 to 45. Ranking by stars alone would put every entry from one large repository in the top twenty with identical scores — a ranking of repositories wearing a skill name.',
  'methodology.score.noSafety':
    'Safety is deliberately not an input. Executing code is a fact, not a fault, and scoring it would hide a judgment inside a number. Safety stays descriptive and filterable.',
  'methodology.score.noOverride':
    'There is no editorial override: no manual pinning, no burying. When the ranking is wrong we fix the formula, not the result.',

  'methodology.inclusion.heading': 'Inclusion filter',
  'methodology.inclusion.body':
    'Recall is easy and worthless; precision is the hard part. The filter answers one question: is this meant to be reused by strangers?',
  'methodology.inclusion.r1':
    'It lives in a skills-dedicated repository, or is referenced by a .claude-plugin/marketplace.json.',
  'methodology.inclusion.r2': 'The repository has a README.',
  'methodology.inclusion.r3': 'The description is non-trivial and not specific to its own repository.',
  'methodology.inclusion.r4':
    'It is not under .claude/skills/ — that path is a project-local convention, not a published artifact.',
  'methodology.inclusion.r5': 'It has at least 10 stars, or it belongs to an organisation account.',
  'methodology.inclusion.r6':
    'One entry per publisher per concept, so a single monorepo with hundreds of paths cannot swamp a category.',

  'methodology.safety.heading': 'Safety surface',
  'methodology.safety.body':
    'Every safety fact is derived from the repository contents, never read from a self-declaration in frontmatter. An author who says "no network" and ships a curl call is described accurately here.',
  'methodology.safety.executes':
    'Executes code: the skill directory contains executable script files. We report how many and in which languages.',
  'methodology.safety.network':
    'Network: a script reaches an outbound host. Detected in the script text, not declared.',
  'methodology.safety.env':
    'Reads environment: a script reads process environment variables, which is where credentials usually live.',
  'methodology.safety.noGreen':
    'There is never a green "safe" badge. With a large share of audited skills carrying real flaws, a wrong green badge is a liability. Rows are descriptive, and this ruleset is published.',

  'methodology.counting.heading': 'Counting',
  'methodology.counting.symlinks': 'Symlinks are skipped, so one file linked from five places is counted once.',
  'methodology.counting.dedupe':
    'Entries are deduplicated by git blob SHA, so identical content vendored into several repositories is counted once.',
  'methodology.counting.excluded':
    'Anything under .claude/skills/ is excluded from the count as well as from the catalog.',
  'methodology.counting.dated':
    'Headline counts are always shown with the crawl date that produced them. A number without a date is not reproducible.',

  'methodology.taxonomy.heading': 'Taxonomy',
  'methodology.taxonomy.namingRule':
    'Node names translate the language, never the technical term. A term practitioners say in English in both locales stays in English.',
  'methodology.taxonomy.protectedLabel': 'Protected terms',
  'methodology.taxonomy.protectedNote':
    'These are identical in both locales, and parity is enforced in CI rather than trusted to a translator.',
  'methodology.taxonomy.aliasesLabel': 'Aliases',
  'methodology.taxonomy.aliasesNote':
    'Short forms nobody puts in a label, mapped to the node they resolve to, so search finds them.',
  'methodology.taxonomy.minimumMassLabel': 'Minimum mass',
  'methodology.taxonomy.minimumMassNote':
    'A category with fewer entries than this is shown dimmed and is not clickable. Clicking into an empty dead end is what every awesome-list feels like from the inside.',

  'methodology.provenance.heading': 'Provenance and freshness',
  'methodology.provenance.id':
    'the repository, the exact commit the content was read at, and the file path inside it. Nothing is quoted from a branch name.',
  'methodology.provenance.sourcesLabel': 'Indexed corpus',
  'methodology.provenance.freshnessLabel': 'Freshness',
  'methodology.provenance.freshnessNote':
    'The crawl and the classification pass run on separate schedules and rot independently, so they are always reported as two numbers. A single "last updated" figure would be a lie.',
  'methodology.provenance.skillsLabel': 'Skills indexed',
  'methodology.provenance.sourceCountLabel': 'Source repositories',
  'methodology.provenance.crawledLabel': 'Last crawl',
  'methodology.provenance.classifiedLabel': 'Last classification',
  'methodology.provenance.never': 'never run',
} as const;

const pt: Record<keyof typeof en, string> = {
  'methodology.title': 'Metodologia',
  'methodology.intro':
    'Toda regra que este catálogo aplica está escrita aqui. A ordem é reproduzível: rode a fórmula você mesmo e obtém a mesma classificação.',

  'methodology.score.heading': 'Pontuação',
  'methodology.score.formulaLabel': 'A fórmula',
  'methodology.score.adoption':
    'log10 do número de estrelas do repositório, normalizado. É um sinal de repositório, e aparece rotulado como tal em todo lugar.',
  'methodology.score.maintenance':
    'Decaimento exponencial sobre os dias desde o último commit que tocou o caminho desta skill, com meia-vida de 90 dias. Por skill, não por repositório.',
  'methodology.score.provenance':
    'Estar em um marketplace curado soma 12, conta de organização soma 8, licença declarada soma 5.',
  'methodology.score.completeness':
    'Frontmatter conforme a especificação soma 9, licença resolvível soma 6, descrição real soma 5.',
  'methodology.score.balance':
    'Sinais por skill pesam mais que sinais de repositório, 55 contra 45. Ordenar só por estrelas colocaria todas as entradas de um repositório grande nas vinte primeiras posições com pontuação idêntica — uma lista de repositórios usando o nome de uma skill.',
  'methodology.score.noSafety':
    'Segurança de execução não entra na pontuação, de propósito. Executar código é um fato, não um defeito, e pontuá-lo esconderia um julgamento dentro de um número. Isso continua descritivo e filtrável.',
  'methodology.score.noOverride':
    'Não existe override editorial: nada é fixado nem enterrado à mão. Quando a ordem está errada, corrigimos a fórmula, não o resultado.',

  'methodology.inclusion.heading': 'Filtro de inclusão',
  'methodology.inclusion.body':
    'Abrangência é fácil e não vale nada; precisão é a parte difícil. O filtro responde a uma pergunta: isto foi feito para ser reaproveitado por desconhecidos?',
  'methodology.inclusion.r1':
    'Está em um repositório dedicado a skills, ou é referenciado por um .claude-plugin/marketplace.json.',
  'methodology.inclusion.r2': 'O repositório tem README.',
  'methodology.inclusion.r3': 'A descrição não é trivial nem específica do próprio repositório.',
  'methodology.inclusion.r4':
    'Não está sob .claude/skills/ — esse caminho é convenção local de projeto, não artefato publicado.',
  'methodology.inclusion.r5': 'Tem pelo menos 10 estrelas, ou pertence a uma conta de organização.',
  'methodology.inclusion.r6':
    'Uma entrada por publicador por conceito, para que um único monorepo com centenas de caminhos não domine uma categoria.',

  'methodology.safety.heading': 'Superfície de risco',
  'methodology.safety.body':
    'Todo fato de risco é derivado do conteúdo do repositório, nunca lido de uma autodeclaração no frontmatter. Quem escreve "sem rede" e entrega uma chamada curl aparece descrito com precisão aqui.',
  'methodology.safety.executes':
    'Executa código: o diretório da skill contém arquivos de script executáveis. Informamos quantos e em quais linguagens.',
  'methodology.safety.network':
    'Rede: algum script alcança um host externo. Detectado no texto do script, não declarado.',
  'methodology.safety.env':
    'Lê o ambiente: algum script lê variáveis de ambiente, que é onde credenciais costumam estar.',
  'methodology.safety.noGreen':
    'Nunca existe selo verde de "seguro". Com boa parte das skills auditadas carregando falhas reais, um selo verde errado é responsabilidade nossa. As linhas são descritivas, e este conjunto de regras é público.',

  'methodology.counting.heading': 'Contagem',
  'methodology.counting.symlinks': 'Symlinks são ignorados, então um arquivo apontado de cinco lugares conta uma vez.',
  'methodology.counting.dedupe':
    'Entradas são deduplicadas pelo SHA do blob git, então conteúdo idêntico copiado para vários repositórios conta uma vez.',
  'methodology.counting.excluded': 'Tudo sob .claude/skills/ fica de fora da contagem e do catálogo.',
  'methodology.counting.dated':
    'Números de destaque aparecem sempre com a data da coleta que os produziu. Número sem data não é reproduzível.',

  'methodology.taxonomy.heading': 'Taxonomia',
  'methodology.taxonomy.namingRule':
    'Os nomes dos nós traduzem o idioma, nunca o termo técnico. Termo que a prática fala em inglês nos dois idiomas permanece em inglês.',
  'methodology.taxonomy.protectedLabel': 'Termos protegidos',
  'methodology.taxonomy.protectedNote':
    'São idênticos nos dois idiomas, e a paridade é verificada na CI em vez de confiada a quem traduz.',
  'methodology.taxonomy.aliasesLabel': 'Apelidos',
  'methodology.taxonomy.aliasesNote':
    'Formas curtas que ninguém coloca em um rótulo, mapeadas para o nó que resolvem, para que a busca as encontre.',
  'methodology.taxonomy.minimumMassLabel': 'Massa mínima',
  'methodology.taxonomy.minimumMassNote':
    'Categoria com menos entradas que isso aparece esmaecida e não é clicável. Cair em um beco vazio é exatamente a sensação de usar uma awesome-list por dentro.',

  'methodology.provenance.heading': 'Procedência e atualidade',
  'methodology.provenance.id':
    'o repositório, o commit exato em que o conteúdo foi lido e o caminho do arquivo. Nada é citado a partir de um nome de branch.',
  'methodology.provenance.sourcesLabel': 'Corpus indexado',
  'methodology.provenance.freshnessLabel': 'Atualidade',
  'methodology.provenance.freshnessNote':
    'A coleta e a classificação rodam em agendas separadas e envelhecem de forma independente, por isso são sempre reportadas como dois números. Um único "atualizado em" seria mentira.',
  'methodology.provenance.skillsLabel': 'Skills indexadas',
  'methodology.provenance.sourceCountLabel': 'Repositórios de origem',
  'methodology.provenance.crawledLabel': 'Última coleta',
  'methodology.provenance.classifiedLabel': 'Última classificação',
  'methodology.provenance.never': 'nunca executada',
};

const methodology: Record<Lang, Record<string, string>> = { en, pt };
export default methodology;
