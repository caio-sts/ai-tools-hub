# Catalog volume — Design Specification

**Date:** 2026-10-24
**Status:** Approved 2026-10-24
**Path:** architectural (changes what the harvest stores and which pages the build emits)
**Amends:** [2026-08-29 design](2026-08-29-ai-tools-hub-design.md) §5.1;
[budgeted crawl](2026-09-27-budgeted-crawl-design.md) risk "Output volume"

The catalog outgrew both of its hosts. This spec bounds what the harvest stores and what the build
renders, so the daily crawl can push and the deploy can finish.

---

## 1. The problem, measured

- **Crawl:** 6 of the 8 runs from 2026-10-17 to 10-24 were rejected at push:
  `data/skills.json` was 100.42–104.36 MiB, over GitHub's 100 MiB hard limit. The harvest itself
  ran clean (`failed 0`). 10-21 passed only because the file dipped to 97.3 MiB.
- **Deploy:** last success 2026-10-10 (4 h 33 min). 10-11 and 10-12 were cancelled at the 6 h job
  limit; every run since 10-13 aborts in ~27 s on `Duplicate skill slug`. The site is frozen at 10-10.
- **Corpus on master (10-21):** 73,940 rows, 165 listed. 73,839 (99.86 %) are unclassified and
  sit in `vertical-domain/general`. One repo (`Klotzkette/claude-fuer-deutsches-recht`) holds
  17,475 rows (24 %); 69 repos hold more than 100. Only 2,032 of 4,581 sources have been read.
- **Pages:** every row builds two pages (§5.1), ~148K, of which 99.8 % are `noindex`.
- **Slug:** `slugSegment` replaces anything outside `[a-z0-9._-]`, so
  `flask-сервер-захвата-окна-…` becomes `flask` and collides with a sibling (one collision today).

## 2. Decisions

### D1 — At most 50 unclassified rows per repo

After the pool is assembled (rows read this run plus rows carried forward) and before
`applyListing`, each repo keeps its top 50 unclassified rows by `compareForRank`. A row with an
assignment in `data/assignments.json` is always kept and does not count toward the 50. Rows past
the cap are not written to `skills.json`.

On the current corpus: 73,940 → ~14,500 rows, ~102 MB → ~20 MB.

### D2 — Only listed entries get a page

`getStaticPaths` emits routes for `listed` rows only. An evicted entry keeps its row (subject to D1)
and its re-entry path, but has no page while evicted: its URL returns 404. The `noindex` branch of
the skill page becomes unreachable and is removed.

§5.1 changes from "its page keeps building" to "its page is not built while it is unlisted". The
reason the old rule gave — removing the row would leave nothing to build the page from — still
holds for the row, which D2 keeps; it never required the page to exist.

### D3 — Slugs keep letters of any script

`slugSegment` keeps `\p{L}\p{M}\p{N}` (Unicode letters, combining marks and digits) instead of
`[a-z0-9]`. Marks matter: without them Indic vowel signs drop and `कि`/`की` both become `क`. On the
current corpus: 0 collisions (1 before). URLs change only for paths with non-ASCII characters.

## 3. Consequences

- **Catalog contents.** `K-Dense-AI/scientific-agent-skills` holds 59 of the 64 listed `general`
  slots; D1 cuts it to 50 and the 9 freed slots go to the next-ranked entries. Classified entries
  (`trailofbits/skills` 81, `anthropics/skills` 20) are untouched.
- **A cut row returns** only when its repo is re-read (new `pushedAt`) and it ranks in that repo's
  top 50 again.
- **Stored count drops.** `meta.skillCount` counts stored rows, so it goes from ~74K to ~14.5K.
- **Read throughput is unchanged.** A repo still downloads every `SKILL.md` before the cut
  (accepted 2026-10-05).
- **Sitemap filter removed.** With no unlisted page built it filtered nothing, and it was wrong
  twice over: it matched raw slugs against percent-encoded sitemap URLs, and it would have dropped a
  listed page whose slug an unlisted row shared.
- **Page rank.** The `#N` on a skill page counts listed entries only, since no other page exists.
- **First crawl after merge** rewrites `skills.json` at ~20 MB and pushes; its dispatched deploy
  builds ~330 skill pages.

## 4. Verification

- Unit: cap keeps the top 50 per repo by rank; classified rows survive and do not count; repos at
  or under 50 are untouched.
- Unit: skill routes are emitted for listed rows only; a Cyrillic path gets a distinct slug.
- Full test suite and a local `astro build` against the real `data/` pass.
- After merge: a `workflow_dispatch` crawl pushes, and the deploy it dispatches succeeds.
