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

### 1.3 The unaddressed risk: distribution

Every incumbent is fed by a star funnel or by being a runtime's own registry. A zero-star
Pages site with no inbound links gets no first visitor, and correctness is invisible without
one. The security-first framing exists partly because *"the only catalog that tells you what
a skill can do to your machine"* is linkable in a way that *"another skills directory"* is not.

**This remains the project's largest open risk.** No acquisition plan is specified here.

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
| `cloud-posture` | CSPM, CIEM, IAM least-privilege, permission warnings | NIST PR.AA |
| `containers-kubernetes` | image scanning, KSPM, OPA/Kyverno | Gartner CNAPP |
| `cicd-pipeline` | build integrity, runner hardening, OIDC, action pinning | OWASP A08; SLSA |
| `identity-access` | OAuth/OIDC/SSO/MFA, session & token, RBAC | OWASP A07; CIS 6 |
| `data-protection` | PII/DLP, encryption & KMS, GDPR mapping | NIST PR.DS; CIS 3 |
| `offensive-testing` | DAST, fuzzing, recon, red-team simulation | MITRE ATT&CK; CIS 18 |
| `detection-ir` | SIEM query, alert triage, threat intel, forensics | NIST DE.CM/RS.* |
| `compliance-grc` | SOC2/ISO/HIPAA/PCI evidence, policy-as-code | NIST GOVERN |
| **`ai-agent-security`** | prompt-injection testing, skill/MCP vetting, tool-poisoning | OWASP LLM:2025 |
| `threat-modeling` | STRIDE, attack trees, architecture review | OWASP SAMM |
| `general` | named overflow (mandatory) | — |

`ai-agent-security` is the wedge: **57 of the 199 real security entries matched no classical
bucket** and formed exactly this cluster. 📄

**Do not hard-code OWASP AST01–AST10 as a badge vocabulary.** That project is an Incubator
proposal, 189 stars, created 2026-03-21 ✅ — too young to build UI on. Cite it as reference only.

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

- **Skill** — one per `SKILL.md`. Carries taxonomy, safety, per-path dates. Primary key is
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

**The formula is published on the site and every card's breakdown is openable.** An opaque score
is exactly the failure we criticise in the incumbent (which grades 100% of its top 5,000 entries
"S" and reports `security_scan {total: 203479, passed: 203479, failed: 0}`). 📄

Default sort is **Score**; Stars / Forks / Newest / Updated are sibling tabs. Rank numbers
**renumber on sort change** — a number that never changes is ornament, not information.

---

## 6. Data acquisition

### 6.1 Pipeline — two workflows, never one

**`crawl.yml`** — nightly, off-peak minute, plus `workflow_dispatch`.

- **Discovery (weekly):** `search/repositories` on `topic:` qualifiers, **star-partitioned** to
  beat the hard 1,000-result cap. A `stars>=10` floor reduces `topic:claude-skills` from 7,626
  to ~1,131 repos ✅ and is almost certainly all the quality. Plus one code-search pass for
  `path:.claude-plugin filename:marketplace.json` — the highest-signal structured seed.
- **Enumeration (nightly):** one `GET /repos/{o}/{r}/git/trees/HEAD?recursive=1` per repo returns
  the whole tree. Skip repos whose `pushedAt` is unchanged.
- **Enrichment:** aliased GraphQL, 4 repos per point of 5,000/hr.
- **Content:** `raw.githubusercontent.com` — unauthenticated, CORS `*`. Frontmatter at build;
  full bodies fetched client-side on expand, which also sidesteps rehosting concerns.

**`classify.yml`** — separate workflow that **commits** `data/assignments.json`. Never inside the
Pages build (hard 10-minute deploy timeout). LLM proposes → human reviews the PR diff → build
reads it. Cache by content hash so only new skills cost anything.

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
not under `.claude/skills/`; ≥N stars or an org account. **Publish these rules.**

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
- **Machine-translated at build, cached by content hash:** skill descriptions (short and long).
  Only re-translated when the author changes the source. Every translated block is marked
  *machine-translated* and carries a **see original** control; English stays canonical.
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

**This is load-bearing, not a nicety.** Without per-skill URLs there is no long-tail SEO
(`"sbom diff claude skill"`) and nothing to share — and distribution is the project's largest
risk (§1.3).

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

### 11.3 SEO

`BreadcrumbList` (the taxonomy maps directly) + `ItemList` on category pages + per-entry OG/Twitter
meta + sitemap. Emit `SoftwareApplication` for machine readability but expect no rich result —
Google requires `aggregateRating`, and synthesising ratings from GitHub stars is a guidelines
violation. **Do not do it.**

---

## 12. Governance — CI checks written on day one

Each answers a failure observed in a real catalog.

1. **Minimum mass** — a subdomain is hidden from navigation until it holds ≥5 entries.
2. **Named overflow** — every domain has a `general` leaf.
3. **Unique slug** — `awesome-mcp-servers` shipped a duplicated section.
4. **Alias map** — `k8s→kubernetes`, `appsec→code-application`, `grc→compliance-grc`.
5. **Versioned taxonomy + redirects** — slugs are stable IDs, display names may change.
6. **Referential integrity** — every `primary`/`also` resolves in `taxonomy.json`; `also.length ≤ 2`;
   free tags never drive navigation; no node named `all`/`any`/`none`/`not`.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| **Distribution — no first visitor.** Largest risk; unaddressed. | Security-first framing makes the site linkable. **An acquisition plan is still owed.** |
| **Solo maintenance.** Every incumbent has failed this. | Committing cron keeps itself alive; `workflow_dispatch` escape hatch; no human-in-the-loop step that can become a queue. |
| **PAT expiry silently kills the crawler.** | 1-year fine-grained PAT + calendar reminder, or a GitHub App. Staleness banner driven by `updated_at`. |
| **Symlink / phantom-catalog count inflation.** | Skip mode-120000, dedupe by blob SHA, publish counts with a dated methodology note. |
| **Claiming more safety than we verify.** | Descriptive signals only; publish the ruleset; never a green badge. |
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

1. **Acquisition plan.** How does the first visitor arrive? Unanswered.
2. **Demand evidence.** No research modality measured whether anyone *uses* a skills directory —
   no traffic estimates, no interviews. Stars measure GitHub attention, which we already argued is
   a poor proxy.
3. **Translation budget.** Build-time LLM translation is one-time per skill but non-zero; the cap
   and provider are unspecified.
4. **Curated order.** The composite score defines default rank. Whether a manual editorial override
   exists on top of it is undecided.

---

## Appendix — verification status

Figures marked ✅ were checked directly against the GitHub API on 2026-08-29.
Figures marked 📄 are secondary and are **not independently verified**.

The initial survey produced three errors that were caught and corrected: it claimed
curation had collapsed everywhere (false for VoltAgent), that the 1k–3k tier was empty (it is
occupied), and put `trailofbits/skills` at 496 stars (actually 6,908). It also missed the OpenClaw
ecosystem entirely. **Re-verify any 📄 figure before quoting it publicly.**
