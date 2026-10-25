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
`SKILL.md`: the frontmatter `name` and `description` plus the body, with fenced and inline code,
URLs, HTML tags and Markdown markup removed.

1. Fewer than **100** characters of prose → excluded (too little to judge; the user chose to cut
   rather than keep when unsure).
2. More than **half** of the description's letters are outside the Latin script → excluded. The
   description is the catalog card; the user chose to drop a skill whose card they cannot read,
   even over English instructions. A script count is reliable on short text, where `eld` is not.
3. More than **30 %** of the prose's words are outside the Latin script → excluded, counting two
   CJK characters as one word so dense scripts are not undercounted. This catches Chinese bodies
   peppered with English terms. On the sample, every kept skill is at or under 8 %, every dropped
   one at or over 40 %.
4. Otherwise `eld` decides on the Latin-script text alone: `en` or `pt` → included; anything else
   → excluded.

Per skill, not per repo: a mixed repo keeps its English skills and loses the rest.

### D2 — Dependency

`eld@2.1.0` (Apache-2.0, no dependencies, ~8.8 MB). Only the harvest imports it; the site does
not.

### D3 — Published at `/methodology`

`INCLUSION_RULE_ORDER` gains `unsupported-language`, with its copy in `en` and `pt` (§6.4: a
filter nobody can inspect is indistinguishable from taste).

### D4 — One-off migration of stored rows

The rule runs only when a repo is read, and ~875 repos are skipped as unchanged on each run. A
script, `scripts/backfill-language.ts`, applies it once to every stored row:

- fetches each row's `SKILL.md` at its pinned commit through GraphQL
  (`object(expression: "<sha>:<path>") { ... on Blob { text } }`), 50 per query (~440 queries,
  1 point each; measured ~4 s per query, so ~30 min);
- drops the rows the rule excludes, re-runs `applyListing`, rewrites `skills.json` and
  `meta.skillCount`, and rebuilds the rescue index;
- a row whose blob cannot be fetched is kept and counted in the log, never silently dropped.

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
- Backfill: a dry run prints counts by detected language before anything is written; the data PR
  states rows before and after and passes the full suite.
