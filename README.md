# ai-tools-hub

A bilingual, security-first catalog of **agent skills**, published as a static site at
**<https://caio-sts.github.io/ai-tools-hub/>**.

Every entry shows what it can do to your machine, where it came from, and why it is filed
where it is.

## What this is, and what it is not

It is a **catalog** — discover an entry, evaluate it, copy the install command. It does not
compose, install, or recommend.

It is built for **one reader, its maintainer**. Success is "I open it and it is current and
correct", not visitors. Reach is a side effect of GitHub Pages, not a goal, so SEO beyond a
sitemap, marketing and growth metrics are out of scope.

That makes the **self-updating pipeline the actual product**, and a silently stopped crawler
the headline risk — not distribution. Everything below is arranged around keeping the data
honest rather than around making it bigger.

Volume is solved and unrewarded: `majiayu000/claude-skill-registry` mass-indexes these skills,
is actively maintained, and has 583 stars. What is genuinely empty is taxonomy depth and an
honest safety surface, so this competes on precision and auditability. **Never optimise for
entry count.**

Current state: **101 skills** harvested from **3 sources**, 60 of them listed after the
per-subdomain cap, across **13 domains / 27 leaves**.

## How the data gets there

Three stages, deliberately separate, because they fail differently.

**1. Harvest** — deterministic, no judgment, runs unattended. Discovers repositories, reads
every `SKILL.md`, derives the safety surface from the repository contents, scores, and applies
the per-subdomain listing cap. Never classifies and never translates.

**2. Classification and translation** — needs judgment, so it runs as a scheduled *Claude Code
session* on the maintainer's subscription, never a metered API key and never inside the Pages
build, which has a hard 10-minute deploy timeout. It opens a PR; a human merges it. Reviewing
the taxonomy assignments **is** the product, so automating that merge would remove it. Full
procedure: [`docs/operations/classification-session.md`](docs/operations/classification-session.md).

**3. Build and deploy** — `astro build` plus Pagefind, pushed to Pages by
`.github/workflows/deploy.yml` on every push to `master`.

The two rot independently, and the site's status banner reports crawl date and classification
lag as two separate rows for exactly that reason. If the classification session stops, new
entries do not disappear: they queue in their domain's `general` leaf and the banner says so.
**Stale-but-honest, never silently wrong** — a frozen catalog that still claims to be current
is the failure this project exists to avoid.

## Commands

```bash
npm install
npm run dev          # astro dev
npm run build        # astro build + Pagefind index
npm test             # vitest run — 1164 tests
npm run typecheck    # tsc --noEmit
npm run validate     # the 8 governance checks over taxonomy + assignments
npm run harvest      # needs CATALOG_PAT; writes data/skills.json, collections.json, meta.json
npm run apply        # applies data/assignments.json onto skills.json, offline
```

`npm run apply` exists because harvest applies assignments as it builds each row, but it only
runs with a token and only rebuilds repositories whose `pushedAt` moved. A classification pass
landing between two crawls needs this to reach the site.

Requires Node ≥ 22.18.0 (CI runs 24).

## Data files, and who owns each

| File | Written by | Notes |
|---|---|---|
| `data/skills.json` | harvest; translations by the classification session | bare `Skill[]` |
| `data/collections.json` | harvest | one row per source repository |
| `data/assignments.json` | classification session **only** | flat `Record<skillId, Assignment>`, never an array |
| `data/taxonomy.json` | hand-written | the closed vocabulary, `protected`, `aliases`, `minimumMass` |
| `data/meta.json` | harvest sets `crawledAt`; classification sets `classifiedAt` | the banner reads both |

A skill id is `owner/repo@sha:path`, so it **changes whenever the content is re-read**. Nothing
durable may be keyed to it: assignments and translations carry forward on `repo` + `path`.

An assignment holds exactly `primary` (one leaf), `also` (≤2 leaves) and `tags` (≤10, never
navigational). Facts about the skill itself live on the skill record, not here. `Skill.listed`
is never hand-edited — harvest recomputes it from the per-subdomain cap on every run.

## Ranking

```
SCORE = Adoption 25 + Maintenance 30 + Provenance 25 + Completeness 20   (max 100)
```

Order is the formula alone. **There is no editorial override** — when the ranking looks wrong,
fix the formula, not the result. **Safety is deliberately not an input:** executing code is a
fact, not a fault, and scoring it would hide a judgment inside a number. Safety stays
descriptive and filterable, and there is no green "safe" badge anywhere.

## Governance

`npm run validate` runs eight checks and exits non-zero on failure. CI runs it on every push.

1. Minimum mass — a subdomain stays dimmed until it holds ≥5 entries
2. Named overflow — every domain has a `general` leaf
3. Unique slug
4. Alias map resolves
5. Slug stability — slugs are stable IDs, display names may change
6. Referential integrity — every `primary`/`also` resolves; caps enforced; tags never navigate
7. Protected-term parity across taxonomy node names
8. Protected-term parity between each skill's `description` and its pt-BR translation

Checks 7 and 8 guard the `PROTECTED` list — `CI/CD`, `Kubernetes`, `Supply Chain`, `IaC`,
`SBOM`, `SLSA`, `OWASP`, `MCP`, `DAST`, `SAST`, `IAM` — which are said the same way in both
languages. `Supply Chain` in particular stays `Supply Chain`; the logistics translation is not
security language.

## Outstanding manual setup

Neither crawl schedule runs yet. **Until one of them does, the catalog cannot refresh itself**,
which is the project's largest risk.

**1. The local schedule (primary).** A systemd user timer every 4 hours, backed by a Windows
Task Scheduler task at logon whose only job is to start WSL. `Persistent=true`, so a run missed
with the machine off fires on the next boot.

```bash
mkdir -p ~/.config/ai-tools-hub
printf 'CATALOG_PAT=github_pat_...\n' > ~/.config/ai-tools-hub/harvest.env   # public repos, read-only
chmod 600 ~/.config/ai-tools-hub/harvest.env
bash ops/install-schedule.sh
systemctl --user is-enabled ai-tools-hub-harvest.timer   # expected: enabled
```

**2. The fallback workflow.** `.github/workflows/crawl.yml` runs weekly (Mondays 06:37 UTC) and
fails without its secret:

```bash
gh secret set CATALOG_PAT
```

## Known gaps

- **pt-BR is card-deep.** `descriptionPt` is filled for all 101 entries; `longPt` is
  deliberately `null`, so the expanded panel fetches the author's own `SKILL.md` body in both
  locales. The reader loses no content to the translation.
- **Light mode is inherited**, not art-directed. Legible, but it was designed dark-first.
- **Mobile is unverified** — no narrow-viewport pass has been done.
- Spec §15 parks two calibrations that now have real data to answer them: the minimum-mass
  threshold of 5, and the 25/30/25/20 score weights.

## Documentation

| | |
|---|---|
| [`docs/specs/2026-08-29-ai-tools-hub-design.md`](docs/specs/2026-08-29-ai-tools-hub-design.md) | the design specification — thesis, taxonomy, data model, ranking, risks |
| [`docs/plans/`](docs/plans/) | the two implementation plans, A1–A6 and B1–B5, both complete |
| [`docs/operations/classification-session.md`](docs/operations/classification-session.md) | the runbook for the judgment half of the pipeline |

## A note on tests

The suite once ran 1107 green while the catalog rendered zero cards: every assertion read the
HTML we emitted, which proves what we wrote and not what the build made of it. Two rules came
out of that, and both are load-bearing:

- For anything passing through a build-time indexer or transformer, **assert on the built
  artifact** — `tests/build/pagefind-index.test.ts` gunzips the Pagefind fragments and reads
  what was actually stored.
- **Open the built page in a browser** before calling UI work done. A test that iterates an
  empty list passes while asserting nothing; several here now fail loudly rather than go quiet.
