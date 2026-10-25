# Language filter — Design Specification

**Date:** 2026-10-24
**Status:** Awaiting review
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
- **The full text can.** On the same stratified sample (oversampling the hard cases), checked by
  hand where detectors disagreed:

  | method on the full `SKILL.md` prose | agreement with hand labels |
  |---|---|
  | `tinyld` | ~94 % |
  | `franc` | ~97 % |
  | **script check, then `eld`** | **~99.7 %** (1 miss: Vietnamese written without diacritics) |

- Estimated effect: ~2,000 of 21,777 rows dropped (~9 %), mostly German, Chinese and Korean.
  Portuguese bodies are almost absent from the corpus.

## 2. Decisions

### D1 — Rule `unsupported-language`, per skill

A new inclusion reason, checked after `weak-description` in `includeSkill`, on the prose of the
`SKILL.md`: the frontmatter `name` and `description` plus the body, with fenced and inline code,
URLs, HTML tags and Markdown markup removed.

1. Fewer than **100** characters of prose → excluded (too little to judge; the user chose to cut
   rather than keep when unsure).
2. More than **half** of the letters (`\p{L}`) are outside the Latin script → excluded. This
   catches Chinese, Japanese, Korean, Cyrillic and others even when an English header leads.
3. Otherwise `eld` decides: `en` or `pt` → included; anything else → excluded.

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
  1 point each);
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
