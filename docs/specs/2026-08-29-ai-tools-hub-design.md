# ai-tools-hub — Design Specification

**Date:** 2026-08-29
**Status:** Awaiting review
**Path:** architectural (new project)

A static, bilingual catalog of AI agent skills, organised by a real two-level taxonomy,
published to GitHub Pages. Security-first at launch.

---

## 1. Thesis

> A small, deep, auditable catalog of agent skills — where every entry shows what it can
> actually do to your machine, where it came from (`owner/repo@sha:path`), and why it is
> filed where it is. **Depth over breadth. Judgment over recall.**

**We do not compete on entry count.** Any feature that trades precision for coverage is
rejected by default.

### 1.0 Who this is for, and what success means

**Built for the maintainer first.** The success criterion is *"I open this to find a skill, and it
is current and correct."* Public reach is a side effect of hosting on GitHub Pages, not a goal.

This is a deliberate choice, not a fallback. A catalog with one known user has a real quality bar
and no growth obligation — and it means **the self-updating pipeline is the product**, not a
supporting feature. A catalog that has to be maintained by hand is worth less than the awesome-list
it replaces; one that stays current on its own is worth more. Everything in §6 exists to serve that.

What this removes from scope: SEO work beyond a sitemap, marketing surfaces, growth metrics, and
any feature justified by attracting strangers (§11.3). What it does not remove: precision,
provenance and the safety surface — those are why the maintainer would trust it at all.

### 1.1 Why this positioning

Evidence gathered 2026-08-29. Figures marked ✅ were verified directly against the GitHub
API; figures marked 📄 are secondary and unconfirmed, and should be
re-verified before being quoted publicly.

**Volume is solved and worthless.**

| Fact | Source |
|---|---|
| `majiayu000/claude-skill-registry` publishes 162,143 skills with this exact architecture (Actions crawl → sharded static JSON → client search on Pages) and has **580 stars** | ✅ |
| 351,232 `SKILL.md` files exist on GitHub; 41,984 sit under a repo's own `.claude/skills/` and are not distributable products | 📄 |
| `npx skills add owner/repo` and `/plugin marketplace add owner/repo` already make any repo a registry with no directory in the middle | 📄 |

**The general-catalog space, as it actually stands.** One incumbent is genuinely healthy;
the manually-curated ones have collapsed. Both facts matter, and they point the same way:
do not launch a general catalog, and do not rely on a manual review queue.

| Repo | Stars | State | Source |
|---|---|---|---|
| `VoltAgent/awesome-openclaw-skills` | 52,244 | pushed daily, **1 open issue** — actively maintained, 5,400+ skills | ✅ |
| `VoltAgent/awesome-agent-skills` | 33,259 | pushed daily | ✅ |
| `ComposioHQ/awesome-claude-skills` | 73,928 | **1,353 open issues/PRs**, curation collapsed | ✅ |
| `heilcheng/awesome-agent-skills` | 6,154 | last push **2026-04-05**, 278 open — abandoned | ✅ |

**What is genuinely unoccupied:**

1. **Taxonomy depth.** Every directory examined is one level. `punkpeye/awesome-mcp-servers`
   dumps 199 entries into a single unsegmented `### Security`. The deepest taxonomy found in
   the wild has exactly one child under security. 📄
2. **An honest safety surface.** Snyk's ToxicSkills audit found **36.8% of 3,984 skills had a
   security flaw, 13.4% critical** — measured on ClawHub's corpus, which *has* moderation. 📄
   No catalog answers "what will this do to my machine".
3. **Cross-runtime coverage.** VoltAgent splits Claude and OpenClaw into *separate lists*.
   Nobody indexes across runtimes in one place. ✅
4. **Provenance.** The 162k leader's dominant data source is another aggregator — copies of
   copies. Nobody displays repo + commit SHA + path. 📄

### 1.2 Ecosystem scope note

The initial research pass indexed only `topic:claude-skills` and missed OpenClaw entirely.
Corrected: `openclaw/openclaw` has **388,017 stars** and `openclaw/clawhub` is a hosted
registry (9,369★, MIT) with 13,700+ skills, versioning and moderation. ✅
Topic corpus sizes: `agent-skills` **18,503** · `openclaw` **8,972** · `claude-skills` **7,626**. ✅

This is why the catalog is **runtime-agnostic**, not Claude-specific.

### 1.3 Distribution — explicitly not a goal

Every incumbent is fed by a star funnel or by being a runtime's own registry, and a zero-star Pages
site gets no first visitor. Earlier drafts treated that as the project's largest risk. **Per §1.0 it
is not a risk at all, because reach is not an objective.**

The security-first framing still earns its place — it is what makes the catalog *deep enough to be
worth opening*, and 15 real subdomains beat one flat `### Security` dump whether one person or a
thousand are reading. Should the project ever want an audience, the framing is already there. It is
simply not what any decision optimises for.

---

## 2. Scope

### In scope for v1

- **Agent skills only** (`SKILL.md`-format artifacts), with a `type` field reserved in the
  data model so MCP servers, plugins and subagents can be added later without migration.
- **Runtime-agnostic**: Claude Code, OpenClaw, Codex, Cursor, and the generic `.agents/skills/`
  convention.
- **Harvest + curate**: an Actions pipeline reads known marketplace/collection manifests on a
  schedule; a committed overlay file carries our taxonomy assignments, notes and blocklist.
- **Bilingual EN + pt-BR**.
- **Security domain fully populated**; the other 12 domains exist structurally but stay thin.

### Explicitly out of scope for v1

- Community submission web form (impossible statically — use a GitHub Issue Form later).
- MCP server browse silo (MCP servers appear only as cross-references).
- Per-entry OG images (10k × ~40 KB ≈ 400 MB against a 1 GB cap; ship one template).
- Any runtime call to `api.github.com` from the published page (60 req/hr per IP; conditional
  304 responses still decrement quota 📄). Star counts are baked at build time.
- A composer/cart, and comparison/advisory views. Both were considered and deferred.
- A marketing landing page. **The home goes straight to the taxonomy.**

---

## 3. Taxonomy and classification

### 3.1 Model

**Two levels, closed vocabulary, multi-label with one designated primary.**

```jsonc
{ "primary": "security/supply-chain",   // exactly one — canonical URL + breadcrumb
  "also":    ["devops/ci-cd"],          // <= 2, entry also appears in those lists
  "tags":    ["sbom", "slsa"],          // free, <= 10, search-boost only, NEVER navigation
  "facets":  { "runtime": [...], "risk": {...}, "provenance": {...} } }
```

Multi-label is not optional: of 199 real security entries, **32% match two or more subdomains
and 29% match none**. 📄 Single-parent placement is empirically wrong for one item in three.
Hence every domain carries a **named** `general` leaf — unnamed overflow is worse than named.

Stop at two levels. Three-level hierarchies measurably increase lostness. 📄 Anything tempting
a third tier becomes a facet or a tag — *"Terraform" is a tag, not a sub-sub-category.*

Slugs are stable IDs decoupled from display names ("Software Supply Chain Failures" only
became OWASP A03 in the 2025 edition), and each node carries a `frameworkRefs` array so
labels are citable rather than invented.

### 3.2 Security — 15 nodes

| Slug | Contains | Anchors |
|---|---|---|
| `code-application` | SAST, secure review, CodeQL, vuln triage | OWASP A01/A05/A06:2025 |
| `secrets-credentials` | secret scanning, push protection, vaults, rotation | CIS 5 |
| `supply-chain` | SCA, SBOM, malicious packages, SLSA provenance | OWASP A03:2025 |
| `iac-config` | Terraform/Helm/CFN scanning, CIS benchmarks, drift | OWASP A02 |
| `cloud-permissions` | CSPM, CIEM, IAM least-privilege, permission warnings, attack paths | NIST PR.AA |
| `containers-kubernetes` | image scanning, KSPM, OPA/Kyverno | Gartner CNAPP |
| `cicd-pipeline` | build integrity, runner hardening, OIDC, action pinning | OWASP A08; SLSA |
| `identity-access` | OAuth/OIDC/SSO/MFA, session & token, RBAC | OWASP A07; CIS 6 |
| `data-protection` | PII/DLP, encryption & KMS, GDPR mapping | NIST PR.DS; CIS 3 |
| `offensive-testing` | DAST, fuzzing, recon, red-team simulation | MITRE ATT&CK; CIS 18 |
| `detection-forensics` | SIEM query, alert triage, threat intel, incident response, forensics | NIST DE.CM/RS.* |
| `compliance-grc` | SOC2/ISO/HIPAA/PCI evidence, policy-as-code | NIST GOVERN |
| **`ai-agent-security`** | prompt-injection testing, skill/MCP vetting, tool-poisoning | OWASP LLM:2025 |
| `threat-modeling` | STRIDE, attack trees, architecture review | OWASP SAMM |
| `general` | named overflow (mandatory) | — |

`ai-agent-security` is the wedge: **57 of the 199 real security entries matched no classical
bucket** and formed exactly this cluster. 📄

**Do not hard-code OWASP AST01–AST10 as a badge vocabulary.** That project is an Incubator
proposal, 189 stars, created 2026-03-21 ✅ — too young to build UI on. Cite it as reference only.

### 3.5 Naming rule — translate language, preserve technical terms

Each node carries hand-written `name.en` and `name.pt` (never machine-translated; §8 applies
only to skill descriptions). Two lists make the rule enforceable rather than a matter of taste:

```js
PROTECTED = ["CI/CD","Kubernetes","Supply Chain","IaC","SBOM","SLSA",
             "OWASP","MCP","DAST","SAST","IAM"]
ALIASES   = {grc:"compliance-grc", k8s:"containers-kubernetes", appsec:"code-application",
             cspm:"cloud-permissions", ciem:"cloud-permissions", posture:"cloud-permissions",
             ir:"detection-forensics", siem:"detection-forensics", sca:"supply-chain"}
```

- **PROTECTED** — terms practitioners say verbatim in both languages. If one appears in a
  label in either locale it must appear in the other. Without this, someone eventually
  "improves" `CI/CD` into *Integração Contínua* and the taxonomy silently diverges.
  `supply-chain` is on this list because Brazilian AppSec says *"ataque de supply chain"*;
  *"cadeia de suprimentos"* is logistics language, not security language.
- **ALIASES** — acronyms deliberately kept *out* of visible labels but still searchable.
  The test applied: **if a label needs explaining, the label failed.** `GRC` and `IR` were
  removed from labels on that basis (becoming *Compliance, Risk & Audit* and
  *Detection & Forensics*); both remain findable via alias.
- Node labels avoid literal translation where it produces language nobody speaks —
  `cloud-permissions` rather than *Cloud Posture* / *Postura em Nuvem*.

Slugs remain stable IDs decoupled from display names. These renames are free only because
nothing is published yet; after launch each one costs a redirect.

### 3.3 Top-level domains (13)

`security` · `coding-software` · `devops-infra` · `data-analytics` · `ai-agent-eng` ·
`docs-formats` · `writing-docs` · `research-knowledge` · `design-creative` ·
`business-product` · `productivity` · `agent-authoring` · `vertical-domain`

`vertical-domain` is a pressure valve so long-tail verticals never force a new top-level node.

### 3.4 Facets (4)

1. **Runtime compatibility** — from GitHub topics (accurate for runtime) plus the spec's
   `compatibility` field. Never seed the *content* tree from topics: of 300 `topic:agent-skills`
   repos only **8** carry a `security` topic. 📄
2. **Risk & capability** — `executes-code`, `network`, `reads-env`, `declared-tools`, `portable`.
3. **Provenance & freshness** — org vs personal, stars band, last-updated band, resolved license
   with an explicit *Not declared* state.
4. *(Artifact type — deferred; skills-only in v1.)*

Cross-cutting: every entry carries a `securityRelevant` flag independent of its primary domain,
so a Terraform-linting skill filed under DevOps still surfaces in a site-wide security filter.

**Reserved words:** never name a node `all`, `any`, `none` or `not` — Pagefind filter keys that
silently break filtering. 📄

---

## 4. Data model

### 4.1 Two entities

`alirezarezvani/claude-skills` contains 846 `SKILL.md` paths; `anthropics/skills` contains 20. 📄
So the catalog atom is the **Skill**, not the repo.

- **Skill** — one per `SKILL.md`. Carries taxonomy, safety, per-path dates, and `listed:
  boolean` (§5.1 — false once evicted; the row survives, the listing does not). Primary key is
  synthesised: **`owner/repo@sha:path`** (skills have no version and no namespace primitive).
- **Collection** — the repo/marketplace. Carries provenance, stars, forks, license fallback.

### 4.2 What can actually be harvested

The reference validator's `ALLOWED_FIELDS` is exactly
`{name, description, license, allowed-tools, metadata, compatibility}` — **no category, no tags,
no author, no version**. 📄 **The taxonomy is therefore 100% hub-authored. That is the product.**

Measured field presence across 141 real `SKILL.md` files: 📄

```
name          88%   license        57%   compatibility  16%
description   88%   metadata       48%   allowed-tools   9%
```

**Rule: never build UI requiring a field below 60% presence.** Everything else goes into an
`extras` bag.

### 4.3 Safety surface — derived, not declared

`allowed-tools` exists on only 9% of skills, so a module built on declared metadata renders
blank nine times in ten. Derive instead:

| Row | Source | Coverage |
|---|---|---|
| **Executes code?** | count + languages of files under `scripts/` in the git tree | **100%** |
| **Network / credential reach** | static scan of those scripts for HTTP calls and env reads | **100%** |
| **Declared tool access** | `allowed-tools` verbatim, else *not declared* | 9% |
| **License** | frontmatter → sibling `LICENSE*` → repo SPDX → *unspecified* | ~95% |

This inverts the incumbents: they report what a skill *claims*; we report what it *contains*.

**Never ship a green "safe" badge.** Descriptive rows only, ruleset published. With 36.8% of
audited skills flawed, a wrong green badge is a real liability.

License needs the full fallback because `anthropics/skills` — 172,473★ — has repo
`license: null` while shipping per-skill Apache-2.0 files. ✅

---

## 5. Ranking — the composite score

```
SCORE = Adoption 25 + Maintenance 30 + Provenance 25 + Completeness 20   (max 100)
```

- **Adoption (25)** — `log10(repo stars)` normalised. **Repo-level; labelled as such in the UI.**
- **Maintenance (30)** — exponential decay on days since the **path's** last commit, 90-day
  half-life. Per skill, not per repo.
- **Provenance (25)** — curated marketplace +12, org account +8, license declared +5.
- **Completeness (20)** — spec-conformant frontmatter +9, license resolvable +6, real description +5.

**Safety is deliberately not an input.** Executing code is a fact, not a fault; scoring it would
hide a judgment inside a number. Safety stays descriptive and filterable.

**Why a composite at all.** Stars and forks belong to the *repo*. Ranking by stars puts all 20
`anthropics/skills` entries in positions 1–20 with identical scores — a ranking sorted by repo
wearing a skill's name. Verified in the prototype: with repo-level signals dominant, all four
`trailofbits` skills tied at 92. After rebalancing so per-skill signals outweigh repo-level
ones (55/45), they separate to 93 / 92 / 90 / 77.

**The formula is published at `/methodology` (§10.6) and every card's breakdown is openable**, with
the score chip itself linking to the formula. An opaque score is exactly the failure we criticise in
the incumbent (which grades 100% of its top 5,000 entries
"S" and reports `security_scan {total: 203479, passed: 203479, failed: 0}`). 📄

Default sort is **Score**; Stars / Forks / Newest / Updated are sibling tabs. Rank numbers
**renumber on sort change** — a number that never changes is ornament, not information.

### 5.1 Survival — a per-subdomain cap, not an unbounded index

The catalog has a **ceiling of 60 entries per subdomain**, filled by score. A new skill that outranks
a listed one takes its place. The cap is per subdomain rather than global because browsing is per
subdomain: one global limit would let a populous node (supply-chain) crowd out a thin one
(threat-modeling), and a category nobody can fill is a dead end.

Three rules keep it from misbehaving:

- **Hysteresis.** An entry joins at rank ≤ 60 but is only dropped once it falls past rank 72.
  Entering is harder than staying, so entries at the boundary do not flap in and out week to week.
- **The cap never breaches minimum mass.** It is a ceiling, never a floor: eviction may not take a
  subdomain below the 5 entries §10.1 requires for it to be navigable.
- **Eviction is a flag, not a deletion.** `Skill.listed` goes false. The entry stays in
  `data/skills.json`, keeps being re-scored and re-dated every run, and its page keeps building —
  removing it from the data would leave nothing to build the page from. It disappears from listings,
  facet counts, the search index and the sitemap, and its page carries `noindex` so search engines
  do not surface an entry the catalog does not list. If its score recovers past rank 60 it returns,
  with its original `indexedAt` intact — that date is provenance, not a listing timestamp.

Scores are recomputed for every entry on every run. Only maintenance decays with time, so ranks
drift on their own without any input changing.

**There is no editorial override.** Order is always and only the composite, with no manual pinning
or burying. When the ranking is wrong, **fix the formula, not the result** — that is what keeps
*"the order is reproducible, run it yourself"* true. A hand-adjusted order would make the published
formula decorative, which is precisely the failure we call out in §1.1.

---

## 6. Data acquisition

### 6.1 Pipeline — two workflows, never one

**Where the harvest runs.** The primary schedule is **local**, on the maintainer's machine, because
that is where the Claude Code subscription lives and it makes each run free. WSL2 shuts itself down
when idle, so the trigger has two halves:

- A **systemd timer inside WSL** with `OnBootSec=2min`, `OnUnitActiveSec=4h` and — the load-bearing
  part — **`Persistent=true`**, so a window missed while the machine was off fires as soon as it
  comes back rather than being silently skipped. `cron` has no equivalent: a missed run is simply lost.
- A **Windows Task Scheduler task at logon** whose only job is `wsl.exe -d Ubuntu-26.04 -- true`.
  It starts WSL; systemd does the rest. Without it, "every time the PC turns on" is not a trigger
  WSL can observe.

**`crawl.yml` runs weekly as a fallback**, not as the primary. §13 names a silently stopped pipeline
as the largest risk, and a local-only schedule is silent in exactly the case that matters — the
machine being off for days. The Action costs nothing on a public repo, and its commit doubles as the
repository activity that keeps its own schedule from being auto-disabled after 60 days. The staleness
banner reports which of the two ran last.

The workflow fires on an off-peak, non-zero minute, plus `workflow_dispatch`.

- **Discovery (weekly):** `search/repositories` on `topic:` qualifiers, **star-partitioned** to
  beat the hard 1,000-result cap. A `stars>=10` floor reduces `topic:claude-skills` from 7,626
  to ~1,131 repos ✅ and is almost certainly all the quality. Plus one code-search pass for
  `path:.claude-plugin filename:marketplace.json` — the highest-signal structured seed.
- **Enumeration (nightly):** one `GET /repos/{o}/{r}/git/trees/HEAD?recursive=1` per repo returns
  the whole tree. Skip repos whose `pushedAt` is unchanged.
- **Enrichment:** aliased GraphQL, 4 repos per point of 5,000/hr.
- **Content:** `raw.githubusercontent.com` — unauthenticated, CORS `*`. Frontmatter at build;
  full bodies fetched client-side on expand, which also sidesteps rehosting concerns.

**Classification and translation** — a **scheduled Claude Code session** on the maintainer's
subscription, not an API-key workflow. It proposes `data/assignments.json` and the pt-BR
translations, opens a PR, and a human merges the diff. Never inside the Pages build (hard
10-minute deploy timeout). Cached by content hash, so only new or changed skills are ever
reprocessed.

**Why this split matters.** Harvest is deterministic and must survive the maintainer's absence, so
it lives in a public Action that anyone can read and that runs regardless. Classification and
translation need judgment, so they run where judgment is cheap — and reach the repo as a reviewable
PR either way. Running them on the subscription removes the per-token cost entirely.

Two constraints follow:
- **Subscription usage limits.** The first full pass over the backlog may exceed them; split it
  across several runs. Steady state is tens of entries per run and fits comfortably.
- **This step depends on a human account.** If the maintainer stops, classification stalls while
  harvest keeps running — the site's data stays fresh but new entries queue unclassified. That is
  the correct failure mode: stale-but-honest, never silently wrong. See §13.

### 6.2 Measured rate limits 📄

| Bucket | Limit | Note |
|---|---|---|
| `code_search` | **10/min** | requires auth; 1,000-result cap (422 past page 10) |
| `search` | 30/min | topic sweeps go here, not code search |
| `core` | 5,000/hr | the tree-walk budget |
| GraphQL | 5,000 pts/hr | 4 repos = 1 point |

**Day-1 blocker:** `GITHUB_TOKEN` is repo-scoped and **cannot do global code search**. A
fine-grained PAT (`secrets.CATALOG_PAT`, public-repo read) is mandatory — and PAT expiry silently
kills the refresh cron. Use a 1-year PAT with a calendar reminder, or a GitHub App.

### 6.3 Crawler traps 📄

1. **Symlinks.** 458 of 846 `SKILL.md` paths in one sampled repo are git symlinks (mode `120000`);
   the real count is 388. **Skip mode-120000 and dedupe by blob SHA** or headline counts inflate ~2×.
2. **Phantom catalogs.** Repos advertising "1000+ skills" with zero `SKILL.md`. Resolve
   awesome-lists to real repos; never bootstrap from their prose.
3. **Dead schema URL.** Anthropic's own marketplace declares a `$schema` that 404s. Pin
   SchemaStore URLs explicitly; never validate off the declared `$schema`.
4. **Publisher spam.** Cap one entry per publisher per concept, so a single 846-path monorepo
   cannot swamp a category page.

### 6.4 The inclusion filter is the actual IP

Recall is solved and worthless; precision is unsolved. The filter answers *"is this meant to be
reused by strangers?"* — lives in a skills-dedicated repo or is referenced by a
`.claude-plugin/marketplace.json`; has a README; non-trivial, non-repo-specific description;
not under `.claude/skills/`; ≥N stars or an org account. **These rules are published at
`/methodology` (§10.6)** — a filter nobody can inspect is indistinguishable from taste.

### 6.5 Cron hygiene

Public-repo scheduled workflows are auto-disabled after 60 days without repository activity — but
the nightly commit of a refreshed data file *is* activity, so a committing cron keeps itself alive.
Schedule off the hour. Always add `workflow_dispatch`. Drive a staleness banner from the index's
`updated_at` so users see rot even when we don't.

---

## 7. Licensing and attribution

- **Awesome-lists cannot be copied.** The three largest carry **no LICENSE file** (all-rights-
  reserved). ✅ for ComposioHQ and `anthropics/skills` (`license: null`). Extract repo URLs only —
  facts are not copyrightable — never their curated prose.
- **Descriptions display the author's own text, attributed and linked**, truncated ~160 chars on
  the card, full on expand.
- **Translations** (see §8) are machine-generated at build, cached by content hash, clearly
  labelled, with the original always one click away and canonical.
- Ship a `THIRD_PARTY_NOTICES.md` and a documented **takedown/opt-out path before launch**.

---

## 8. Internationalisation

- **Locales:** `en` (default) and `pt-BR`, routed as `/en/` and `/pt/`.
- **Hand-written in both:** all UI chrome, taxonomy display names, facet labels, our editorial
  notes, and the score-model explanation.
- **Machine-translated, cached by content hash:** skill descriptions (short and long). Only
  re-translated when the author changes the source. Every translated block is marked
  *machine-translated* and carries a **see original** control; English stays canonical.
- **Produced by the scheduled Claude Code session** (§6.1), not by a metered API key — so
  translation has no per-token cost. Model choice is therefore a quality decision, not a budget
  one. The `PROTECTED` list (§3.5) is part of the translation prompt, and protected-term parity
  is enforced in CI (§12) rather than trusted to the model.
- Language choice persists across visits.

---

## 9. Design system

### 9.1 Foundations

**One file — `src/styles/theme.css`, Tailwind v4 `@theme`.** It emits CSS custom properties *and*
generates utilities: no JS config, no codegen, no second source of truth. Open with
`--color-*: initial` to wipe Tailwind's defaults so nobody can reach for `bg-indigo-500`.

**Two OKLCH ramps** — neutral `n-1…n-12` and accent `a-1…a-12` — using Radix step *roles* so
hover/border/focus are decidable rather than guessed:

```
1–2  app background      6  subtle border         9–10  solid / hover
3    component bg        7  interactive border    11    low-contrast text
4    hover               8  focus ring            12    high-contrast text
5    pressed / selected
```

Semantic aliases use **shadcn's exact names** (`--background`, `--foreground`, `--card`, `--muted`,
`--border`, `--ring`, `--radius`, `--destructive`) mapped onto the ramps, so any shadcn block
pasted in later is already themed — without adopting shadcn's zero-chroma greys.

**Theming is three-state, and deliberately not CSS `light-dark()`** — that function is Baseline
only since May 2024, *narrower* than Tailwind v4's own Safari 16.4 floor, so combining them
silently drops colour on supported browsers. Instead: full light palette on bare `:root`; dark
overrides in `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`;
repeated under `:root[data-theme="dark"]`.

Motion: 90 ms state / 150 ms enter / 220 ms overlay, one easing curve, inside a
`prefers-reduced-motion` kill-switch.

**Ship a `/styleguide` route** rendering every token and component state — the cheapest drift
detector for a solo maintainer.

### 9.2 Art direction — Industrial Console

Chosen from three candidates (Terminal Ledger, Field Guide, Industrial Console).

- Dark-first control surface; light theme ships as a full peer.
- Panelled cards, 1px borders, no radius, no shadows.
- **JetBrains Mono** for every identifier, path, count, command and metric; **Archivo** for prose.
- Status LEDs for runtime compatibility.
- **Hazard orange is reserved exclusively for the safety module** and appears nowhere else, so
  "this skill executes code" is unmissable without a badge economy.
- Stale dates (>60 days) render in hazard orange.

---

## 10. Information architecture

### 10.1 Home — goes straight to the taxonomy

No marketing page. Structure:

1. One-line thesis + one supporting sentence.
2. Stats strip: skills, sources, domains, last refresh.
3. **Security, fully expanded** — all 15 subdomains as a clickable grid.
4. The other 12 domains below, present but honestly thin.

**Every node renders in one of three states, and none of them lie:**

| State | Meaning | Treatment |
|---|---|---|
| **Active** | at or above minimum mass | accent, clickable, count shown |
| **Below minimum mass** | has entries, too few to navigate to | dimmed, not clickable |
| **No entries** | not yet indexed | em-dash, "no entries yet" |

**Minimum mass = 5** in production. This is governance, not decoration: without it, clicking a
category lands you in an empty dead end — which is what every awesome-list feels like inside.

### 10.2 Catalog

- Persistent left facet rail ordered by decision frequency: **Risk → Subdomain → Runtime → License**.
  Risk is first because *"hide anything that executes code"* is the query no competitor can answer.
- Counts on every facet value, showing what each option **would** return if added to the current
  selection.
- Multi-select checkboxes, active-filter chips with individual remove, clear-all, designed empty state.
- **Sort as tabs, not a dropdown** — each a distinct URL.
- **Numbered pagination**, not infinite scroll — crawlable.
- **Card grid, 4/5/6 columns** (default 6, degrading to 5 below 1500 px and 4 below 1280 px).

### 10.3 Card anatomy

Closed card, in order: **rank · score · runtime LEDs · name · description (2-line clamp) ·
safety strip · source repo · stars + forks · picked + updated dates.**

Two deliberate omissions:
- **No license chip on the card.** It resolves to unknown often enough that a frequently-empty
  chip teaches people to ignore chips. It is a rail filter and an expanded-card row instead.
- **No category chip when already filtered into that category** — it appears only in search
  results and unfiltered views, where it carries information.

The safety strip sits **above** the metadata: the eye lands on it before the star count.

### 10.4 Expanded card — replaces a separate detail page

Clicking a card expands it in place (spanning ~half the grid width; one card open at a time).
It reveals: full author description · the four score bars · provenance
`owner/repo@sha:path/SKILL.md` · **Official file ↗** linking to the source `SKILL.md` ·
copyable install command · resolved license with *Not declared* in hazard orange.

**Expansion and a real URL are not alternatives — we ship both.** Expanding rewrites the URL to
`/skills/<slug>/`, and Astro generates a static page at that same URL from the same data. Click
= instant expand; direct visit or shared link = full static page.

**Both are cheap, so ship both.** Astro generates the static page from the same data the expansion
already renders. The justification is shareable links, bookmarks and a working back button — not
search traffic (§11.3).

### 10.6 `/methodology` — the published ruleset

The spec promises to "publish" a rule in five separate places — the safety ruleset (§4.3), the score
formula (§5), the inclusion filter (§6.4), a dated counting-methodology note and the safety ruleset
again (§13). **One page discharges all five.** Without it those are five promises with no address,
and a catalog whose entire moat is auditability would be asking to be taken on trust — which is the
failure it accuses the incumbent of.

One route per locale, `/{lang}/methodology/`, containing:

| Section | Content | Discharges |
|---|---|---|
| **Score** | The formula, all four weights, how each component is computed, and why safety is deliberately not an input | §5 |
| **Inclusion filter** | What makes a skill eligible — *"is this meant to be reused by strangers?"* — as the explicit rule list | §6.4 |
| **Safety surface** | How `executes code` / `network` / `reads env` are derived from repo contents rather than read from frontmatter, and why there is never a green badge | §4.3, §13 |
| **Counting** | Symlinks skipped, blob-SHA dedupe, `.claude/skills/` excluded — so headline counts are reproducible and dated | §13 |
| **Taxonomy** | The naming rule, `PROTECTED`, `ALIASES`, minimum mass | §3.5, §10.1 |
| **Provenance & freshness** | What `owner/repo@sha:path` means, which sources were harvested, last crawl and last classification | §6.1 |

**Access is the requirement, not just existence.** The score chip on every card links to the score
section's anchor, and a persistent footer link reaches the page from anywhere. A reader who has just
seen a number is one click from how it was produced.

Content is hand-written in both locales (§8) — it is our own editorial text, never machine-translated.

### 10.5 Accessibility

- WCAG 2.2 **2.5.8**: facet rows and chips need ≥24×24 px hit areas.
- WCAG 2.2 **2.4.11**: `scroll-margin-top` equal to header height so the sticky header cannot
  obscure a focused facet.
- The search box is a real **ARIA combobox**, not an input plus a div of results.
- Result counts in `aria-live="polite"` on a ~300 ms debounce, not per keystroke.
- Skip link to `#results`; after "clear all filters", move focus to the results heading.

---

## 11. Stack and deployment

| Concern | Choice | Reason |
|---|---|---|
| SSG | **Astro 7.2.9**, static output, content collections | One real HTML file per skill and per taxonomy node. **Reject any SPA** — Pages has no rewrite rules, so SPA deep links 404 on direct navigation. |
| Search | **Pagefind 1.5.2** via `astro-pagefind` 2.0.1, faceted-browse mode | At 1,000 pages: 121 KB initial payload, **filter index 5.8 KB** 📄 — pure facet browsing is nearly free, and that is the default access pattern. |
| Typo rescue | **MiniSearch 7.2.0**, names + aliases only | Pagefind has **zero typo tolerance**; "kubernets"/"terrafrom" return nothing. Not polish — required. |
| Styling | **Tailwind v4.3.3**, CSS-first `@theme` | §9.1. |
| Deploy | `configure-pages@v6` · `upload-pages-artifact@v5` · `deploy-pages@v5` · `withastro/action@v6.1.2` · `@astrojs/sitemap@3.7.3` | Custom Actions workflow, **not** the classic branch build (which waives the 10-builds/hour limit). |

**Rejected:** Orama 3.1.18 — persisted JSON must download and parse in full before the first
keystroke: 2.95 MB gzipped at 1,000 docs would burn the 100 GB/month budget at ~34k visits. 📄
Lunr (abandoned). Fuse.js (no inverted index, no facet counts). Algolia/Typesense free tiers
(runtime API key in public HTML with no server to rate-limit it).

### 11.1 GitHub Pages constraints

**1 GB site (hard) · 100 GB/month bandwidth (soft) · 10-minute deploy timeout.**
`upload-pages-artifact` defaults `include-hidden-files: false`, silently dropping every dotfile —
**set it true**. `.nojekyll` is unnecessary under the Actions path. **Make the repo public**:
Actions is free and unmetered there, and public runners get 4 vCPU / 16 GB.

### 11.2 Base path — decided

Ship as a **project page at `/ai-tools-hub/`**, with `site` + `base` in `astro.config` on day one
and a **base-aware `<Link>` helper written before the first page**. Hand-written `href="/skills/…"`
works locally and 404s in production — the single most common Pages failure. Pagefind has its own
independent `bundle-path`/`baseUrl` config that must agree, or the search bundle 404s.

A custom domain later removes `base` and adds `public/CNAME` — a one-commit upgrade.

### 11.3 SEO — cut to the sitemap

**Out of scope per §1.0.** Structured data (`BreadcrumbList`, `ItemList`, `SoftwareApplication`),
per-entry OG/Twitter meta and any rich-result work existed to attract search traffic the project is
not seeking. Ship `@astrojs/sitemap` because it is one config line, and stop there.

Per-skill static pages stay (§10.4) — but on their own merits: a shareable link, a working back
button, and a bookmarkable address. Not for search.

*(If this ever reverses: never synthesise `aggregateRating` from GitHub stars to chase a rich
result. It is a Google guidelines violation subject to manual action.)*

---

## 12. Governance — CI checks written on day one

Each answers a failure observed in a real catalog.

1. **Minimum mass** — a subdomain is hidden from navigation until it holds ≥5 entries.
2. **Named overflow** — every domain has a `general` leaf.
3. **Unique slug** — `awesome-mcp-servers` shipped a duplicated section.
4. **Alias map** — see §3.5.
5. **Versioned taxonomy + redirects** — slugs are stable IDs, display names may change.
6. **Referential integrity** — every `primary`/`also` resolves in `taxonomy.json`; `also.length ≤ 2`;
   free tags never drive navigation; no node named `all`/`any`/`none`/`not`.
7. **Protected-term parity** — every term in `PROTECTED` that appears in a label in one locale
   must appear in the other (§3.5), and every `ALIASES` key must resolve to a real node.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| **Local runs stop when the machine is off.** | The weekly Action fallback (§6.1) bounds how stale the catalog can get regardless, and `Persistent=true` makes the local timer catch up rather than skip. |
| **The pipeline silently stops. This is now the largest risk.** Per §1.0 the self-updating flow *is* the product: a catalog frozen in September is worse than none, because it is trusted and wrong. | Every failure must be loud. Staleness banner driven by `updated_at`, reporting crawl date and classification lag separately (§6.1); `workflow_dispatch` as a manual escape hatch; the nightly commit is itself the repository activity that keeps the schedule alive. **Treat a silent crawler as a P1 bug, not a maintenance chore.** |
| **Solo maintenance.** Every incumbent has failed this. | Committing cron keeps itself alive; no human-in-the-loop step that can become a queue. |
| **Classification depends on a human account.** The scheduled Claude session is not a robot; if the maintainer stops, new entries queue unclassified. | Harvest stays in Actions so data never goes stale on its own; unclassified entries land in the domain's `general` leaf rather than disappearing, and the staleness banner reports the classification lag separately from the crawl date. |
| **PAT expiry silently kills the crawler.** | 1-year fine-grained PAT + calendar reminder, or a GitHub App. Staleness banner driven by `updated_at`. |
| **Symlink / phantom-catalog count inflation.** | Skip mode-120000, dedupe by blob SHA, and publish the counting rules with a date at `/methodology` (§10.6). |
| **Claiming more safety than we verify.** | Descriptive signals only; the ruleset is published at `/methodology` (§10.6); never a green badge. |
| **Copyright on curated prose.** | Extract facts only; author descriptions verbatim and attributed; takedown path before launch. |
| **Two independent base-path configs.** | Base-aware `<Link>` helper before the first page; assert Astro `base` and Pagefind `baseUrl` agree in CI. |
| **SEP-2640 (Skills-over-MCP)** could let servers self-advertise skills, eroding third-party directories. | Own judgment and curation — the one layer no protocol serves. Make generated per-category `marketplace.json` bundles a first-class output. |

---

## 14. Deferred but designed for

**Generated `marketplace.json` per taxonomy node.** The format supports `strict: false` plus a
`skills[]` array, so `/plugin marketplace add <hub-repo>` could install an entire curated category
in one command — turning a static catalog into an install target with no server. 📄 No awesome-list
and no directory does this. Not in v1, but nothing in this design precludes it.

---

## 15. Open questions

**None blocking.** The two that stood here — how the first visitor arrives, and whether anyone uses
a skills directory — were dissolved rather than answered: per §1.0 the project is built for its
maintainer, so neither question gates anything. They would return the day the project wants an
audience.

Remaining judgment calls, all safe to settle during implementation:

1. **Minimum-mass threshold.** Set at 5 (§10.1) on reasoning, not measurement. Revisit once the
   real distribution of entries per subdomain is known.
2. **Score weights.** 25/30/25/20 is defensible but unvalidated against a real corpus; the first
   full harvest is the moment to sanity-check that the ranking matches the maintainer's own
   judgment of the top 20.
**Resolved 2026-08-29:** translation runs on the maintainer's Claude Code subscription rather than
a metered API key, so there is no budget to cap (§6.1, §8); and there is **no** editorial override —
order is the formula alone (§5).

---

## Appendix — verification status

Figures marked ✅ were checked directly against the GitHub API on 2026-08-29.
Figures marked 📄 are secondary and are **not independently verified**.

The initial survey produced three errors that were caught and corrected: it claimed
curation had collapsed everywhere (false for VoltAgent), that the 1k–3k tier was empty (it is
occupied), and put `trailofbits/skills` at 496 stars (actually 6,908). It also missed the OpenClaw
ecosystem entirely. **Re-verify any 📄 figure before quoting it publicly.**
