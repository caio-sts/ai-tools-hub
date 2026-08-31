# Runbook — scheduled classification and translation session

Harvest runs whether or not anyone is watching: a systemd user timer on the maintainer's machine
every 4 hours, backed by a weekly public GitHub Action so days with the machine off cannot silence
it. Classification and
pt-BR translation are not like that: they need judgment, so they run as a **scheduled Claude Code session on
the maintainer's subscription** — deliberately **not a metered API key**, and never inside the Pages
build, which has a hard 10-minute deploy timeout.

Both halves reach `main` as a reviewable diff. This document is the procedure for the half a
workflow file cannot express.

## When it runs

- Weekly, on the maintainer's machine or a scheduled cloud session.
- After any large harvest, when the status banner shows a growing classification lag.
- On demand, whenever the banner reports entries queued unclassified.

The harvest runs every 4 hours locally and weekly in Actions, and is unaffected by this schedule. The two rot independently, and the banner
reports them as two separate rows for exactly that reason.

## Inputs

| File | Role |
|---|---|
| `data/skills.json` | a bare `Skill[]` of every harvested skill, written by the harvest (`scripts/harvest/run.ts` locally, `crawl.yml` weekly) |
| `data/taxonomy.json` | the closed vocabulary: 13 domains, the 15 security leaves, `protected`, `aliases`, `minimumMass` |
| `data/assignments.json` | what previous sessions already decided; the cache |
| `data/meta.json` | `crawledAt`, `classifiedAt`, `skillCount`, `sourceCount` |

Skill ids embed the commit the content was read at — `owner/repo@sha:path` — so a re-crawl of an
active repository produces new ids for unchanged skills. Carry a previous decision forward by
matching on `repo` + `path`, and re-judge only when the skill's name or description text actually
changed. That is what keeps a weekly run cheap.

## What the session produces

A write to `data/assignments.json`, which is a flat `Record<skillId, Assignment>` — never an
array, never a versioned envelope — and whose entries carry exactly three fields:

```jsonc
{
  "owner/repo@sha:path/SKILL.md": {
    "primary": "security/supply-chain",
    "also": ["devops-infra/cicd"],
    "tags": ["sbom", "slsa"]
  }
}
```

Rules the session must hold to:

- `primary` is exactly one slug and must resolve in `data/taxonomy.json`.
- `also` holds at most 2 slugs.
- `tags` holds at most 10 free terms. Tags never drive navigation.
- Nothing else belongs in an assignment. Facts about the skill itself — including whether it is
  security-relevant, and its translated description — live on the skill record, not here.
- A skill with no entry here is not lost: it renders in its domain's named `general` leaf and is
  counted in the banner's "queued unclassified" row.
- `Skill.listed` is **never** hand-edited. The harvest recomputes it from the per-subdomain cap on
  every run (§5.1). An entry evicted from its listing still needs a classification, still keeps its
  page, and still counts in the queued-unclassified row.

### Translation rules

- Translate only skill descriptions, written onto the skill record's `descriptionPt` and `longPt`
  fields in `data/skills.json` — never into `data/assignments.json`. UI chrome, taxonomy display
  names, the methodology page and our editorial notes are hand-written in both locales and are never
  machine-translated.
- English stays canonical. Every translated block is labelled machine-translated in the UI and keeps
  a "see original" control.
- The `PROTECTED` list goes into the translation prompt verbatim:
  `CI/CD`, `Kubernetes`, `Supply Chain`, `IaC`, `SBOM`, `SLSA`, `OWASP`, `MCP`, `DAST`, `SAST`, `IAM`.
  These are said the same way in both languages. `Supply Chain` in particular stays `Supply Chain` —
  the logistics translation is not security language.
- Protected-term parity is enforced in CI, not trusted to the model.

## Procedure

1. Pull `main` and create a branch:
   ```bash
   git switch -c "classify/$(date +%Y-%m-%d)"
   ```
2. Run the session over the unassigned or changed skills only, in batches (see **Usage limits**).
3. Write the results into `data/assignments.json`, and any new translations onto the matching
   records in `data/skills.json`.
4. Set `classifiedAt` in `data/meta.json` to the ISO timestamp of this run. The banner's
   classification lag is computed from it, so a PR that forgets this step lies to the reader.
5. If any skill *name* changed, regenerate the typo-rescue index so search still finds it:
   ```bash
   node scripts/build-rescue-index.ts
   ```
6. Validate before opening anything:
   ```bash
   node scripts/validate-taxonomy.ts
   npx vitest run
   npx astro build
   ```
   `scripts/validate-taxonomy.ts` runs the governance checks, including referential integrity for
   every `primary` and `also` and protected-term parity. It exits non-zero on failure.
7. Open the PR:
   ```bash
   git add data/assignments.json data/skills.json data/meta.json public/rescue-index
   git commit -m "chore(classify): assignments and pt-BR translations"
   git push -u origin HEAD
   gh pr create --fill --title "Classification pass $(date +%Y-%m-%d)"
   ```
8. **A human merges the diff.** The session never pushes to `main` and never enables auto-merge.
   Reviewing the taxonomy assignments is the product; automating the merge would remove it.

## Usage limits

The first full pass over the harvest backlog **may exceed** the subscription's usage limits. Do not
attempt it in one sitting: **split it across several runs**, one batch of roughly 50 entries per
run, committing after each batch so no work is repeated after an interruption.

Steady state is **tens of entries** per run and fits comfortably inside a single session.

## Failure mode

If the maintainer stops running this session, harvest keeps running and the site's data stays fresh.
New entries simply queue unclassified: they land in their domain's named `general` leaf rather than
disappearing, and the status banner reports the classification lag as its own row, separate from the
crawl date.

That is the intended behaviour — **stale-but-honest, never silently wrong**. A frozen catalog that
still claims to be current is the failure this project exists to avoid.
