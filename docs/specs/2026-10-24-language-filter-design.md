# Language filter — Design Specification

**Date:** 2026-10-24
**Status:** Approved 2026-10-24
**Path:** architectural (new inclusion rule, new dependency, one-off data migration)
**Amends:** [2026-08-29 design](2026-08-29-ai-tools-hub-design.md) §6.4

The catalog serves a reader of English and Portuguese. This spec admits only skills written in one
of those two languages, judged per skill from the full `SKILL.md`.

---

## 1. The problem, measured

- After the [catalog volume](2026-10-24-catalog-volume-design.md) cap, master holds 21,777 rows.
  German, Chinese, Korean, Japanese and Russian skills are stored, classified and ranked like any
  other, though nobody here reads them.
- **The description alone cannot decide.** `tinyld` on name + description labelled thousands of
  rows Berber, Esperanto, Tagalog or Latin; in a 314-skill sample, ~90 % of rows it called Spanish,
  French or Portuguese had English bodies.
- **The full text can, with care.** On the same stratified sample (oversampling the hard cases),
  checked by hand wherever methods disagreed. A first pass that skipped the frontmatter and read
  only 4,000 characters reported ~99.7 % for `eld`; on the real input it does worse, because `eld`
  answers `ja` or `ru` for an English body with a Japanese or Russian description. Measured on the
  full `SKILL.md` (frontmatter included) with the rule in D1:

  | method | agreement with hand labels |
  |---|---|
  | `tinyld` on the prose | ~94 % |
  | `franc` on the prose | ~97 % |
  | **D1: script shares, then `eld` on Latin text only** | **312 / 314** (both misses: Vietnamese written without diacritics, kept) |

- Estimated effect: ~2,000 of 21,777 rows dropped (~9 %), mostly German, Chinese and Korean.
  Portuguese bodies are almost absent from the corpus.

## 2. Decisions

### D1 — Rule `unsupported-language`, per skill

A new inclusion reason, checked after `weak-description` in `includeSkill`, on the prose of the
`SKILL.md`: the frontmatter `name` and `description` plus the body, with fenced code (backtick or
tilde, closed only by a matching fence, also inside list items and blockquotes; an unclosed fence
runs to the end), inline code, URLs and autolinks, HTML tags and Markdown markup removed. The
harvest logs which step excluded a skill.

1. `too-short` — fewer than **100** characters of prose (the user chose to cut rather than keep
   when unsure).
2. `description-script` — more than **half** of the description's letters are outside the Latin
   script. The description is the catalog card; the user chose to drop a skill whose card they
   cannot read, even over English instructions.
3. `description-language` — a Latin-script description of at least 100 characters that `eld`
   reliably places in another language. Below 100, `eld` is confidently wrong on English cards
   ("Svelte stores and runes" → Danish); every flagged description from 100 characters up on
   master is German. A short foreign card over English instructions therefore passes.
4. `body-script` — more than **30 %** of the prose's words are outside the Latin script, counting
   two CJK characters as one word. On the sample, every kept skill is at or under 8 %, every
   dropped one at or over 40 %.
5. `body-language` — `eld` reads only the first 1,000 characters of its input, so the Latin-script
   prose is judged in 1,000-character windows; under half of it in `en` or `pt` → excluded. An
   English intro over a German body does not pass.

`eld` only ever sees Latin-script text: it answers `ja` for English with one Japanese phrase.
Sample result: 313 / 314 agree with the hand labels (the miss: Vietnamese written without
diacritics, kept).

Per skill, not per repo: a mixed repo keeps its English skills and loses the rest.

### D2 — Dependency

`eld@2.1.0` (Apache-2.0, no dependencies, ~8.8 MB). Only the harvest uses it, and only once it
has a skill to judge: `loadLanguageDetector()` imports the model on demand (~0.8 s, ~135 MB), so
`apply-assignments` and most tests never pay for it.

### D3 — Published at `/methodology`

`INCLUSION_RULE_ORDER` gains `unsupported-language`, with its copy in `en` and `pt` (§6.4: a
filter nobody can inspect is indistinguishable from taste).

### D4 — One-off migration of stored rows

The rule runs only when a repo is read, and ~875 repos are skipped as unchanged on each run. A
script, `scripts/backfill-language.ts`, applies it once to every stored row:

- is a **dry run unless `--write`** is given, and refuses any other argument; the dry run reports
  drops by rule and by repo;
- fetches each row's `SKILL.md` at its pinned commit through GraphQL
  (`object(expression: "<sha>:<path>") { ... on Blob { text } }`), 25 per query (measured ~2.3 s:
  ~35 min for the catalog), judging batch by batch;
- retries 5xx and network errors, waits out 403/429 and `RATE_LIMITED` (`retry-after`, else a
  minute), and treats every per-alias error other than `NOT_FOUND` as an unread batch;
- **aborts before writing** if any batch stays unreadable; only a blob GitHub no longer has
  (`NOT_FOUND`) is kept and counted;
- keeps every verdict in `node_modules/.cache/backfill-language.json`, so an aborted run resumes
  where it stopped and the `--write` run reuses the dry run's reading instead of fetching again;
- refuses to write if `data/` changed while it was reading;
- drops the excluded rows and rewrites the catalog through `rewriteCatalog` (shared with
  `apply-assignments`: listing recomputed, `meta.skillCount` updated);
- sets `pushedAt` to `NEVER_CRAWLED` on every repo that lost a row, so the crawl re-reads it and a
  sibling the dropped row had displaced (concept cap, `REPO_CAP`) can return. Never-read repos still
  come first, so this delays genuinely changed repos by at most one run, once;
- `node scripts/build-rescue-index.ts` then rebuilds the rescue index, as in the classification
  runbook.

It runs locally on a fresh master outside the crawl window (06:37 UTC), and its output lands as
its own data PR.

## 3. Consequences

- A dropped row returns only if its `SKILL.md` changes to English or Portuguese.
- Rule order is the log's explanation: a German skill with a one-word description still logs
  `weak-description`.
- The crawl skips script fetches for excluded skills, so it reads a little faster.
- Classified rows are not exempt: a classified non-EN/PT skill is dropped like any other.

## 4. Verification

- Unit: German, Chinese-with-English-header, Japanese, short English (< 100 chars) and Portuguese
  fixtures taken from the sample; the rule order; `/methodology` lists the new rule in both locales.
- Backfill: a dry run prints drops by rule and by repo before anything is written; the data PR
  states rows before and after and passes the full suite.
