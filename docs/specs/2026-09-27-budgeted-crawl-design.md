# Budgeted, resumable crawl — Design Specification

**Date:** 2026-09-27
**Status:** Awaiting review
**Path:** architectural (changes how the harvest persists state between runs)
**Amends:** [2026-08-29 design](2026-08-29-ai-tools-hub-design.md) §6.1, §6.2, §6.5

A full-discovery harvest has never finished. This spec makes it finish, over several runs if it
has to: it narrows discovery, cuts the per-repo request cost, stops itself before any quota or the
job timeout, and resumes where the last run stopped.

---

## 1. The problem, measured

- `crawl.yml` failed 4/4 scheduled runs (2026-08-31 → 09-21) on a missing `CATALOG_PAT`. With the
  secret set, the first real run (`workflow_dispatch`, run 36356425683) hit the **50-minute job
  timeout** with zero lines of output.
- The published catalog is a **three-repo allowlist seed** from 2026-08-30 (`anthropics/skills`,
  `trailofbits/skills`, `heilcheng/awesome-agent-skills`). No full crawl has ever completed.
- Discovery admits **7,005 repos** in ~4 min. A recursive tree read costs ~0.7 s. `SKILL.md` per
  repo ranges from 0 to 903 in a 15-repo sample.
- Today each repo costs, on the `core` bucket (5,000/h): a tree read **twice** (`enumerateSkills`
  and `runHarvest` both call `fetchTree`), one `fetchHeadCommit`, and **one `commits?path=` call
  per `SKILL.md`**. The 7,005 tree reads alone exceed an hour of quota.
- Nothing is written until the run ends, and the `pushedAt` skip only knows repos in the previous
  `collections.json` (three). **Every run restarts from zero and cannot finish.**
- Core fetchers (`fetchTree`, `fetchPathCommit`, `fetchHeadCommit`) throw on 403/429 instead of
  waiting or stopping.
- Two silent-failure paths: a timeout concludes `cancelled`, so the `if: failure()` issue step is
  skipped; and `DEFAULT_DEPS` passes no `log`, so production prints nothing.

The 2026-08-29 spec sized this at ~1,131 repos (one topic) and "one tree call per repo". The code
sweeps five topics and adds a call per `SKILL.md`.

## 2. Decisions

| Question | Decision | Rejected |
|---|---|---|
| Narrow discovery? | Drop `mcp-server`; keep `claude-code` only at `>=1000` and `100..999` stars | Dropping `claude-code` entirely (see §3.1) |
| Per-`SKILL.md` commit | Batch through GraphQL, 50 paths per query | Keep REST (bootstrap takes months); drop per-path commits (changes §5 maintenance semantics) |
| Partial catalog during bootstrap | Publish progressively, with a coverage indicator | Hold until complete (site stays at 3 repos); publish with no indicator |
| Cadence | `crawl.yml` **daily**; the local timer becomes optional | 6-hourly (4 commits + deploys a day); weekly + local timer (depends on the machine) |

## 3. Harvest engine

### 3.1 Discovery

Topics become per-topic star partitions:

| Topic | Partitions |
|---|---|
| `claude-skills` | `>=1000`, `100..999`, `10..99` |
| `agent-skills` | `>=1000`, `100..999`, `10..99` |
| `openclaw-skills` | `>=1000`, `100..999`, `10..99` |
| `claude-code` | `>=1000`, `100..999` |

`mcp-server` is removed. The `marketplace.json` code-search seed is unchanged.

Evidence, from repos only one source finds, with a random sample of 12 of them checked for a
`SKILL.md`:

| Source | Repos | Exclusive | Sample with `SKILL.md` |
|---|---:|---:|---:|
| `claude-skills` | 1,293 | 791 | 7/12 |
| `agent-skills` | 1,831 | 1,131 | 9/12 |
| `openclaw-skills` | 157 | 89 | 8/12 |
| `claude-code` | 2,583 | 1,812 | 7/12 |
| `mcp-server` | 2,133 | 1,851 | 3/12 |
| `marketplace.json` seed | 259 | 246 | 10/12 |

`claude-code` yields nearly as well as the skill topics, so it stays; its `10..99` band alone holds
7,610 repos, so it goes. The per-topic floor is a new rule: `MIN_STARS` stays the global gate, and
a topic may only raise its own floor, never lower it.

### 3.2 Per-repo cost: ~1 core request

- **Pinned commit from enrichment.** `buildEnrichQuery` adds `defaultBranchRef { target { oid } }`.
  That oid pins every read of the repo in this run. It replaces both `fetchHeadCommit` calls.
- **One tree read, by oid.** `git/trees/{oid}?recursive=1` (checked: the endpoint accepts a commit
  oid), fetched once and handed to both enumeration and the safety/license pass. Reading by oid
  rather than `HEAD` makes the tree, the path commits and every raw fetch one consistent snapshot.
- **Path commits in GraphQL batches.** One query per 50 paths:
  `repository(owner, name) { object(oid: $oid) { ... on Commit { p0: history(first: 1, path: …) { nodes { oid committedDate } } … } } }`.
  Measured: 50 paths, 1 request, 1.5 s, **cost 1 point**; sha and date identical to REST
  `commits?path=&per_page=1` on 3 of 3 checked paths. A path with empty history falls back to the
  pinned oid with `UNKNOWN_UPDATED_DAYS`, as today.
- Raw content (`raw.githubusercontent.com`) is unchanged: no quota, but it is now the dominant time
  cost.

A repo with no `defaultBranchRef` (empty repo) is skipped, as a 409 tree is today.

### 3.3 The queue

A repo **needs reading** when it has no row in the previous `collections.json`, or its fresh
`pushedAt` differs from the stored one. Order:

1. Never read, by stars descending.
2. Changed, by **stored** `pushedAt` ascending — the stalest data first.

Unchanged repos are skipped as today. The stored `pushedAt` is the only cursor; no new field. This
is what makes a run continue where the last one stopped, and what stops a few busy repos from
starving the rest.

### 3.4 Budget guard

Before starting each repo, the run stops cleanly if any of these holds:

| Guard | Source | Default |
|---|---|---|
| `core` remaining < reserve | `x-ratelimit-remaining` on the last core response | 200 |
| GraphQL remaining < reserve | `rateLimit { remaining }` on the last query | 200 |
| Elapsed ≥ time budget | `HARVEST_TIME_BUDGET_MIN` env; unset means no time limit | 35 in `crawl.yml` |

A 403/429 inside a repo means that repo is discarded whole, and the run stops cleanly. Any other
error inside a repo (a 5xx, a network failure, a data-less GraphQL body) discards that repo whole
too, and the run **continues** with the next one; the job fails after the commit (§7). No retries.
It never writes a half-read repo. The guard runs between repos, so the time margin (90 − 35 min)
must cover the largest single repo plus the commit step: the largest discovered repo,
`sickn33/antigravity-awesome-skills` (2,741 `SKILL.md` paths), is estimated at ~13 min, which the
old 15-min margin (50 − 35) did not safely cover. There is no in-repo deadline.

### 3.5 What each run writes

| Repo state at the end of the run | `collections.json` row | `skills.json` rows |
|---|---|---|
| Read this run | fresh | rebuilt |
| Unchanged since last read | fresh | carried forward (classification re-applied, as today) |
| Changed, not reached | **previous** row, old `pushedAt` — so it stays queued | carried forward |
| Never read, not reached | none | none |
| No longer discovered | none | none |

A repo read this run gets its row **even when it yields zero skills** — otherwise it would be
re-read every run. A repo discarded mid-read (§3.4) is treated as "not reached". `writeCatalog` and
`writeMeta` run once, at the end of every clean stop.

### 3.6 Logging

`DEFAULT_DEPS` passes `log: console.log` to discovery and enumeration. Each run ends with one
summary line, e.g. `harvest: read 1830, unchanged 0, deferred 2570, failed 2, stopped: time budget`
(`deferred` counts every queued repo not read, failed ones included). Per repo, it logs
`harvest: <repo> failed: <message>` (the run continues), `harvest: <repo> discarded: <message>`
(rate limited; the run stops), and `harvest: <repo> read in <n>s` when a read took ≥ 60 s.

## 4. Data contract

- **`meta.discoveredCount: number`** — repos admitted by this run's discovery ("M").
- `meta.sourceCount` keeps its meaning and invariant: `collections.json` length, the repos we hold
  data for ("N"). **Partial** ⇔ `sourceCount < discoveredCount`.
- `Meta` (`src/types.ts`) and `loadMeta` (`src/lib/data.ts`) learn the field. `loadMeta` copies
  known fields only, and `scripts/apply-assignments.ts` rewrites `meta.json` through it — without
  this, every classification PR would erase the field. The `SiteMeta` reader in
  `src/lib/staleness.ts` only reads, never writes, and no staleness logic needs coverage, so it is
  left alone.
- A `meta.json` without the field reads as `discoveredCount = sourceCount` (complete).
- `validateCatalog` adds `discoveredCount >= sourceCount`.
- `skills.json` and `collections.json` row shapes do not change. `collections.json` now lists repos
  with data, not every discovered repo.

## 5. Site

- Home stats: while partial, the Sources cell reads **"1,830 of 4,400"** / **"1.830 de 4.400"**;
  once complete, the bare number as today.
- Methodology, "Source repositories": same rule.
- Strings live in the existing `stats.*` and `methodology.provenance.*` keys, EN and pt-BR.
- Partial is not an error: no hazard colour. Hazard orange stays reserved for staleness.

## 6. Workflow and ops

- `crawl.yml` cron → daily, `'37 6 * * *'` (off the hour, inside the 03–09 UTC window). The header
  comment is rewritten: Actions is now the primary, the local timer optional.
- `HARVEST_TIME_BUDGET_MIN: '35'` on the harvest step; `timeout-minutes: 90` (was 50; §3.4).
- The harvest step records node's exit code (`set +e`, `exit=$?` to `$GITHUB_OUTPUT`) instead of
  failing on it, so the rescue index, commit and publish still run; a final step fails the job when
  that code is not 0. A missing PAT still fails the step at once.
- A publish step after the push dispatches `deploy.yml` and `ci.yml` (`actions: write`): a push
  made with `GITHUB_TOKEN` starts no workflow, and `deploy.yml` is the only Pages publisher.
- Issue step runs on `failure() || cancelled()`. Cost: a manual cancel also reports.
- Issue title becomes `P1: crawl failed`. If one is open, a new failure **comments on it** instead of
  opening another; daily cadence would otherwise open up to 30 a month.
- The daily `--allow-empty` commit still keeps the schedule alive (§6.5).
- `ops/` is unchanged but for one comment. Local and Actions runs share one PAT's quotas; running
  both at once can conflict on `data/*.json`, and a second run that reads nothing fails loudly.
  Prefer one schedule.

## 7. Failure handling

| Situation | Exit | Effect |
|---|---|---|
| Stopped by a guard, ≥1 repo read | 0 | partial progress committed, reason logged |
| 403/429 mid-repo, ≥1 repo read | 0 | that repo discarded and logged, the run stops; earlier repos committed |
| Any other error inside a repo (including a bug in the read path) | **1, after the commit** | that repo discarded and logged, the run continues; everything else (reads, unchanged repos, `crawledAt`) is committed and published, then issue — even when every queued repo failed |
| **A stop (guard or 403/429) with 0 repos read** | **1** | `StuckCrawlError`, nothing written; issue — the crawler is stuck, and that must not be silent |
| An error outside a repo read (discovery, enrichment, writing) | 1 | nothing written; issue, as today |
| Job timeout (should not happen with §3.4) | cancelled | issue, via `cancelled()` |

## 8. Testing and verification

Vitest, injected-deps style of `tests/harvest/`:

- each guard, with fake clock and fake headers; stop happens between repos, never mid-repo;
- queue order: never-read by stars, then stalest stored `pushedAt`;
- the five rows of §3.5;
- 403/429 mid-repo discards that repo only;
- zero-progress with a non-empty queue exits 1;
- GraphQL path-commit query building (batches of 50) and parsing, including empty history;
- tree fetched once per repo, by oid; no `fetchHeadCommit` call;
- per-topic partitions: no `mcp-server`, no `claude-code stars:10..99`;
- `discoveredCount` survives `loadMeta` and `applyAssignmentsToCatalog`; legacy default; validation rule;
- Sources cell: "N of M" when partial, bare number when complete, both languages;
- `tests/workflows/crawl.test.ts`: daily cron, budget env, `cancelled()`, issue reuse.

Before claiming done: `npm test`, `npm run typecheck`, `npm run build`, and the home page checked in
a browser, not only in markup. After merge: dispatch `crawl.yml` and watch it to a clean stop with a
commit; close #4, #14, #15, #16 once a run succeeds.

## 9. Documents to amend

- 2026-08-29 spec §6.1 (where the harvest runs, cadence, topics), §6.2 (the per-path cost, the
  GraphQL path-history measurement), §6.5 (daily commit).
- README "Scheduling" section: daily Actions primary, local timer optional.

## 10. Estimate

After the cut, roughly **4,400 repos** (estimated from §3.1, not measured post-cut). Tree reads
(~0.7 s each) make time, not quota, the binding constraint: **a few daily runs** to finish the
bootstrap, then one run a day covers the repos that changed. Raw-fetch concurrency is the next
lever if bootstrap proves too slow; not in scope.

## 11. Known gaps, out of scope

- **Search truncation.** Several partitions exceed the 1,000-result cap (e.g. `claude-code
  100..999` has 2,094); the rest are dropped without notice. Finer partitions would recover them.
- **Carried-forward scores are not recomputed.** Only `buildSkill` calls `scoreSkill`, so skipped
  and deferred rows keep their old score and `updatedDays`, contrary to §5 ("recomputed for every
  entry on every run"). Pre-existing; this design carries more rows forward, so the gap grows.
- **Output volume.** `skills.json` is ~2 KB per row: ~25k rows passes GitHub's 50 MB warning and
  ~50k hits the 100 MB push limit. Choose a storage plan before that.
- **A repo refused mid-read on every run.** It stays at the head of the queue, so an oversized repo
  that trips a rate limit every time keeps the crawler stuck — loudly (§7), but stuck.
- **A repo needing more than 55 minutes** (90 − 35) would still cancel the job.
