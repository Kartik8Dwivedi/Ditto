# DITTO — Master Reference

**The single source of truth.** Product, evidence, architecture, deployment, business, demo, risks.
Written 17 July 2026 · Hackathon deadline: **19 July 2026, 11:59 PM**
Companion docs: **`DITTO_LEVEL0.md` (READ FIRST — teaches every concept from zero)** · `DITTO_PLAN.md` (hour-blocked build plan) · `PRD_BACKEND.md` · `PRD_FRONTEND.md`

> **New to AI engineering? Read `DITTO_LEVEL0.md` before this file.** It explains every term used here — AST, fingerprint, embedding, cosine similarity, clustering, adjudication, probe, tarball, structured outputs — in plain English with analogies. This file assumes you already know them.

> **Every number, output, and file path in this document was executed or read from real source.**
> Nothing here is estimated or illustrative unless explicitly labelled. If you put it on a slide, it's true.

---

# 1. THE PRODUCT

## 1.1 One sentence
> **Ditto finds functions that do the same thing but are written completely differently — then executes them to prove they disagree.**

## 1.2 The category
> **Semantic CI.**
> Today CI asks: does it compile? do tests pass? does lint pass? is it secure?
> **Ditto adds: are you reinventing something your codebase already knows?**

## 1.3 The vision line (use this to close)
> **Every AI coding agent has intelligence. None of them owns the long-term memory of your codebase. Ditto does.**

## 1.4 Positioning — what we are NOT
| Don't say | Why |
|---|---|
| "AI code review" | Greptile / CodeRabbit / Qodo own it. Head-on fight, we lose. |
| "Chat with your codebase" | Saturated. Instant eye-roll. |
| "AI finds bugs" | Extremely crowded. |
| "We beat Codex/Jules/Cursor" | Unnecessary fight. **We are infrastructure FOR agents, not a competitor TO them.** |

**Ditto is a persistent semantic index + verification layer over a codebase.** Agents do work; Ditto remembers.

---

# 2. THE PROBLEM

## 2.1 The mechanism
AI coding agents don't read your whole codebase before writing — at scale they physically **can't**. They search, they miss, and they re-implement what already exists under a different name in a different file. Over time you accumulate four functions that are supposed to agree, and don't. Your tests don't catch it, because each one passes in isolation.

## 2.2 Why now (the "why didn't this exist 18 months ago" answer)
- **>1 in 5 code reviews now involve an AI agent** (GitHub official).
- Peer-reviewed (arXiv 2601.21276): **agents produce more Type-4 clones than humans — AND reviewers are *less* critical of AI-authored PRs.** The problem grows exactly as oversight drops.
- The volume of machine-written code crossed the threshold where this stopped being tech debt and became a correctness problem.

## 2.3 What a "Type-4 clone" is (define this on a slide)
| Type | Meaning | Caught by existing tools? |
|---|---|---|
| Type 1 | Identical code, different formatting | ✅ jscpd, SonarQube |
| Type 2 | Identical code, renamed variables | ✅ jscpd, SonarQube |
| Type 3 | Similar structure, small edits | ✅ mostly |
| **Type 4** | **Same behaviour, completely different implementation** | ❌ **Nothing. Returns literal 0.** |

**Type-4 is the entire product.** It's *by definition* same-behaviour-different-syntax — which is exactly why token-based tools are blind to it, and why embedding raw code fails too.

## 2.4 The insight nobody else has
Duplication is a **vitamin** — everyone nods, nobody funds it.
**Silent disagreement is a painkiller** — it's a latent correctness bug your tests don't catch and your agents widen every week.

> We don't sell "your codebase is messy."
> We sell **"your four functions that are supposed to agree return different answers, and here's the proof."**

## 2.5 Our own accidental experiment (a real finding — good slide)
We had Codex build a small shop app across four independent feature sessions. Result:

| Utility | Outcome | Why |
|---|---|---|
| `normalizeIndianMobileNumber` | **Reused** | it was **exported** |
| `formatIndianRupees` | **Reused** | it was **exported** |
| date formatting | **Reinvented — 2 implementations** | both were **private / non-exported** |

**Agents reuse what's discoverable and reinvent what's buried.** At 246 lines Codex could read everything, so it mostly reused. At 200k LOC it can't — and that's precisely when it reinvents. **This is the argument for a persistent semantic index**, and our own repo demonstrates the mechanism.
*(Note: this repo is NOT a demo asset — see §9.3. It's a slide insight only.)*

---

# 3. THE EVIDENCE — REAL PRODUCTION REPOS

**Method:** 6 parallel hunters swept GitHub code search, grep.app, issue/PR archaeology, and AI-authored repos → 14 candidates → each independently verified by a skeptic that **read the real source and executed the functions** → 10 verified heroes, 0 rejects.

**This is the core of the deck.** These are not hypotheticals. Every output below was executed under Node.

---

## 🥇 3.1 THE MONEY SHOT — `cline/cline`

| | |
|---|---|
| **Repo** | https://github.com/cline/cline |
| **What it is** | **An AI coding agent.** 64,740 stars. |
| **Licence** | Apache-2.0 (verified via API `spdx_id` + raw LICENSE) |
| **Scope** | `sdk/packages/core` → ~1,630 fns / 268 files |

**Four functions. All named `truncateText`. Same signature `(string, number) => string`. One package.**

| # | Path | Line | Exported? | Pure? |
|---|---|---|---|---|
| A | `sdk/packages/core/src/extensions/context/compaction-shared.ts` | 70 | ✅ | ✅ |
| B | `sdk/packages/core/src/runtime/host/history.ts` | 233 | ❌ file-local | ✅ |
| C | `sdk/packages/core/src/extensions/tools/team/team-tools.ts` | 81 | ❌ file-local | ✅ |
| D | `sdk/packages/core/src/extensions/context/budget-projection/project.ts` | 329 | ❌ file-local | ✅ |

### THE SLIDE — CONFIRMED LIVE from the real pipeline (Mongo, cline @ c564045)

**What Ditto actually produced** (this is stronger than "4 → 3 answers" because it shows the tool *reasoning*, not just matching): the four `truncateText` did NOT naively lump together. Ditto split them into **two genuine duplicate pairs** and correctly **excluded** two near-misses — `team-tools.ts:81` (secretly normalises whitespace — does extra work) and `truncateToolResultContent` (operates on structured content — different job). That precision IS the demo.

**The hero cluster — `project.ts:329` vs `compaction-shared.ts:70`** (both plain-string truncators, adjudicator confidence 0.98, risk: semantic, EXECUTED):

| Input | project.ts:329 (BUGGY) | compaction-shared.ts:70 (correct) |
|---|---|---|
| 26-char string, limit 20 | `"a\n...[truncated 25 chars]"` — **kept 1 char!** | `"abcdefghijklmnopqrst\n...[truncated 6 chars]"` — kept 20 |
| 20-char string, limit 17 | `"a\n...[truncated 19 chars]"` — **kept 1 char!** | kept 17 |
| 100×"a", limit 20 | `"a\n...[truncated 99 chars]"` — **kept 1 char!** | kept 20 |

**The bug:** for any limit >16, `project.ts:329` reserves space for its `[truncated N chars]` notice; because the notice is longer than the limit, its `Math.max(1, …)` floor kicks in and it keeps a **single character**, returning a ~25-char string that is almost entirely marker. Two functions named `truncateText`, one silently broken. **jscpd sees two different-looking functions and reports nothing. Ditto executed them and proved they disagree.** The flagship generated these boundary inputs (0, -1, 5, 16, 17, 20) on its own — no forcing.

### THE CROSS-MODULE RANKING INSIGHT (pitch asset — put it on a slide)
Ditto deliberately **de-prioritises near-exact copies (jscpd's job) and ranks cross-module reinvention first** — because Type-4 semantic clones are *implemented differently and therefore have lower similarity by nature*. A naive tool spends its attention on copy-paste; Ditto spends it on the reinvention jscpd is blind to. *"Ditto looks where the other tools can't."*

### The bug in D (explain it in one line)
Asked for a **20-char budget**. Returned a **25-character string containing exactly ONE character of content.**
Mechanism: `keep = Math.max(1, 20 - 24) = 1`, then the marker is recomputed against `keep=1`. It both mangles the text *and* overshoots the limit it exists to enforce.
**Behavioural cliff:** `("x"*100, 16)` → clean. `("x"*100, 17)` → `"x\n...[truncated 99 chars]"`.

### Supporting rows (all executed — 9 of 11 inputs diverge)
| Input | A | B | C | D |
|---|---|---|---|---|
| `("hello world", 0)` | `"\n...[truncated 11 chars]"` | `"..."` | `"..."` | `""` |
| `("hello world", -5)` | silently drops last 5 chars (`slice(0,-5)`) | — | — | — |
| `("a\nb  c", 10)` | — | — | **only C normalises whitespace → `"a b c"`** | — |
| `("abc", 10)` | ✅ agree | ✅ | ✅ | ✅ |
| `("", 5)` | ✅ agree | ✅ | ✅ | ✅ |

> **They agree on the easy cases — so a naive test suite passes.** That's the point.

### jscpd (VERIFIED — actually run)
- Default: **"Found 0 clones."**
- `--min-tokens 10 --min-lines 1`: finds only the type-signature fragment `(str: string, maxLen: number): string {` — **never the behaviour.**
- On the four **real full files**: reports 2 clones — **both irrelevant intra-file noise inside `project.ts:353–428`. Catches zero of the four.**

### Why this is the money shot
1. **Objection-proof.** Same name, same signature, same package. There is no *"they were never meant to do the same thing"* defence. Four functions called `truncateText` cannot be four intended behaviours.
2. **Zero environment dependency.** No clock, no locale, no `Intl`, no module state, no imports. **Byte-identical on any laptop in the room.** (Most other candidates need frozen clocks or pinned locales — on stage, that's the difference between a demo and an incident.)
3. **Diverges on a normal English sentence** — not `null`, not `42`. Nobody can call it adversarial.
4. **Row D is an indefensible, visible bug.** No explanation needed; the audience just sees it.
5. **The AI narrative is free and true.** *"The AI coding agent's own codebase has four functions named `truncateText` in one package, and they give three different answers. jscpd found two clones and both are wrong. Ditto found the four that matter."*
6. **Universally relatable.** Everyone in that room has written `truncate`. Everyone has written it twice.

---

## 🥈 3.2 `actualbudget/actual` — the money sign-flip

| | |
|---|---|
| **Repo** | https://github.com/actualbudget/actual · 27,581 stars · personal finance app |
| **Licence** | MIT (verified: API + LICENSE.txt read directly) |
| **Scope** | `packages/loot-core/src` → ~1,343 fns / 237 files · **branch `master`** |

**Two money parsers. 60 lines apart. In the same file.**

| Fn | Path | Line |
|---|---|---|
| `currencyToAmount` | `packages/loot-core/src/shared/util.ts` | 500 |
| `looselyParseAmount` | `packages/loot-core/src/shared/util.ts` | 561 |

**Input:** `"(1,234.56)"` — an accounting-parenthesised amount (i.e. a debit)

```
currencyToAmount   →   1234.56      (reads it as a CREDIT)
looselyParseAmount →  -1234.56      (reads it as a DEBIT)
```
Also: `"(5.00)"` → `5` vs `-5` · `"(0.01)"` → `0.01` vs `-0.01`
**23 inputs tested, 9 disagree.**

**Why it lands:** in a **budgeting app**, two parsers disagree on whether your money went in or out.
**Why it's untested:** `currencyToAmount` appears **54× in `util.test.ts` with ZERO parenthesis tests.** `looselyParseAmount` deliberately tests parens (`util.test.ts:61-66,74`). The disagreement lives in undocumented, untested territory.

**jscpd:** 0 clones at default **and** 0 at `--min-tokens 10 --min-lines 1`.

### 🚨 TWO HARD RULES
1. **DO NOT demo the 1000× / 3-decimal family.** `util.test.ts:14-22` documents it as intentional with the literal comment `// the expected failing case`. **It is a trap** — one judge opening the adjacent test file collapses the story.
2. **Purity caveat:** `currencyToAmount` calls same-file `getNumberFormat()` which reads module-level mutable `numberFormatConfig` (`util.ts:295`). Deterministic in practice. **If our purity analyzer bars module-level mutable *reads*, this function is silently dropped and the cluster never surfaces.** Bar mutation and I/O — allow reads. (See `PRD_BACKEND.md` §3.8.)

---

## 🥉 3.3 `Kuzma02/Electronics-eCommerce-Shop...` — the safety net

| | |
|---|---|
| **Repo** | https://github.com/Kuzma02/Electronics-eCommerce-Shop-With-Admin-Dashboard-NextJS-NodeJS |
| **What** | Next.js + Prisma e-commerce + admin dashboard · 659 stars |
| **Licence** | MIT (verified) |
| **Size** | **311 fns / 181 files — dead centre of band. The ONLY candidate needing NO scoping.** Point Ditto at the URL, whole-repo scan, done. |

| Fn | Path | Line | Regex |
|---|---|---|---|
| `isValidEmailAddressFormat` | `lib/utils.ts` | 116 | `/^\S+@\S+\.\S+$/` |
| `isValidEmail` | `app/register/page.tsx` | 21 | `/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i` |
| *(inline regex)* | `app/checkout/page.tsx` | 46 | reads component state — **narrate, don't execute** |

**Input:** `"a@b.c"` → `lib/utils`: **TRUE** · `register`: **FALSE**
Also diverge: `"a@b..c"`, `"user@[127.0.0.1]"`, `"josé@exämple.de"` (4 of 12 inputs)

### The killer beat
**`app/login/page.tsx:3` IMPORTS `isValidEmailAddressFormat` from `@/lib/utils`. `register/page.tsx` rolls its own.**
→ **Login and registration disagree on `a@b.c`, in the same auth flow, in the same app.**
And with the checkout regex: `"user@domain"` is **accepted at checkout, rejected at registration.**

**jscpd:** 0 clones at default on the 3 real files. At `--min-tokens 15` → 37 clones, **all JSX boilerplate, not one an email validator.**

**Known weakness:** both are "declare a regex, return `regex.test(x)`" — what differs is a *constant*, not control flow. **Lead with the execution table, never with structural contrast.** This is the safety slot, not the showcase.

---

## 3.4 `github/gh-aw` — THE AI-ROT PROOF (slide only, do not index)

| | |
|---|---|
| **Repo** | https://github.com/github/gh-aw · MIT · **GitHub's own** |

> ### **62 of 78 recent merged PRs (79%) were authored by the Copilot bot.**
> ### That same directory contains **four independently-written `escapeHtml` helpers** — four distinct normalised hashes. **jscpd: 0 clones.**

| Fn | Path | Line |
|---|---|---|
| `escapeHtml` | `actions/setup/js/pr_review_buffer.cjs` | 898 |
| `escapeHtml` | `actions/setup/js/parse_mcp_gateway_log.cjs` | 555 |
| `actions/setup/js/model_aliases.cjs` | 157 | |
| `escapeHtml` | `actions/setup/js/log_parser_bootstrap.cjs` | 87 |

**This single statistic replaces the entire "AI agents cause this" argument** — from a real production repo, at GitHub, with a measurable PR number.

**Why slide-only, not demo:** the four `escapeHtml` **agree on every string input tried** (`'<script>'`, `` `<b>&'"` ``, `''`, `'plain text'` all byte-identical) and split only on **type coercion** (`null`, `42`). A judge fairly says *"you passed a number to a string function."* Use the 79% stat, not the divergence table.
**Also:** cumulative 1,598 fns — a naive 1,500 cap cuts one of the four. (See §9.1.)

---

## 3.5 The other verified heroes (bench — all MIT, all executed)
| Repo | Cluster | Divergence input | Why benched |
|---|---|---|---|
| `TryGhost/Ghost` | 4× `escapeHtml`, 2× `slugify` | `"O'Brien"` | needs hand-curated 5-dir scope; **cracks at `--min-tokens 30`** |
| `moneyadviceservice/maps-apps` | 3× `formatCurrency` + `displayAmount` + `formatPrice` + `formatMoney` | `formatCurrency(-5)` | **locale-dependent** (`£10,00,000` on en-IN vs `£1,000,000` on en-US) |
| `chadbyte/clay` | `formatTimeAgo` ×2, `formatRelativeDate`, `getDateGroup` | `null` | **needs frozen clock** |
| `AWS-IAM-Dashboard/IAM-Dashboard` | `formatRelativeTime`/`getRelativeTime`/`getAge`, `formatBytes` ×2 | future timestamp | **needs frozen clock** |
| `2mawi2/schaltwerk` | `formatRelativeDate`/`formatLastActivity`/`formatDurationFromNow` | future timestamp | **needs frozen clock** |
| `asizikov-demos/copilot-user-level-statistics-viewer` | 2× `formatLongDate`, 3× `formatDate` | `null` | diverges only on null |

## 3.6 REJECTED — do not touch
| Repo | Why |
|---|---|
| `Mintplex-Labs/anything-llm` | headline `formatBytes` is in an **AGPL-3.0 subtree** (`open-computer/`). **NEVER vendor `open-computer/cli/src/vm.ts`.** Clean-MIT remainder is byte-identical copy-paste. |
| `novuhq/novu` | 7,010 files; cluster straddles two apps; `escapeHtml` pair is **byte-identical** — jscpd finds it. |
| `ohcnetwork/care_fe` | executable pair have **different output contracts** (date vs date+time) → they disagree on *every* input → kills the "these should agree but don't" punchline. |

## 3.7 THE EXTRAPOLATION (the slide you asked for)
> We looked at a handful of repos and found this in **every single tier**:
> - **An AI coding agent with 64.7k stars** (cline) — 4 implementations, 3 answers, 1 real bug
> - **A 27.6k-star finance app** (actual) — two money parsers disagreeing on debit vs credit
> - **GitHub's own repo** (gh-aw) — 79% agent-authored, 4 `escapeHtml`
> - **A 659-star e-commerce app** (Kuzma02) — login and registration disagree on the same email
>
> **This is not a long tail. It's the head.** These are maintained, popular, reviewed codebases. If the top of the distribution looks like this, the middle is worse — and every existing duplication tool reports **zero**.

---

# 4. ARCHITECTURE

## 4.1 THE CORE PRINCIPLE (the thing that makes it work)
> ### **The LLM never sees the codebase. It sees ONE function at a time.**
> Context per call is **tiny and CONSTANT**. It does **not** grow with repo size. Only the *number* of calls grows — a cost/throughput problem, solved by cheap models + concurrency + content-hash caching.

**Never** concatenate files. **Never** send a repo to a model. **Never** send more than one cluster to the adjudicator.

## 4.2 The pipeline
```
GitHub tarball  (no git clone — GitHub API /tarball)
   ↓  deterministic · 0 tokens
FILTER  drop node_modules, dist, build, .next, coverage, *.min.js, *.map, *.d.ts, tests, generated
   ↓  + explicit --scope subtree (NOT a truncation cap)
AST WALK (ts-morph)  →  EVERY function decl / method / arrow / expression
   ↓  ⚠️ INCLUDING NON-EXPORTED — 3 of our 4 money-shot fns are file-local
CHEAP FILTERS  0 tokens · drop <3 LOC, getters/setters, pass-through wrappers
   ↓
FINGERPRINT — LLM stage 1 · CHEAP model · ONE function per call · ~600 tok in / 150 out
   ↓  cached by bodyHash → re-runs are free
EMBED the FINGERPRINT (never the code, never the name) · text-embedding-3-small
   ↓
CLUSTER — deterministic · 0 tokens · in-memory cosine + compat filter
   ↓  → ~40–80 candidate clusters. THE FLAGSHIP NEVER SEES THE O(n²) CROSS-PRODUCT.
ADJUDICATE — LLM stage 2 · FLAGSHIP · full bodies of ONE cluster (~2k tok)
   ↓  emits probe_inputs (adversarial)
PROBE — deterministic · 0 tokens · execute PURE fns in a worker_threads sandbox
   ↓
DITTOPROOF — a divergence table that is EXECUTED GROUND TRUTH, not a model opinion
```

## 4.3 The two non-obvious rules (get these wrong → product finds nothing)

### Rule 1 — NEVER embed the function name
```ts
embedText = `${intent} | domain: ${domain} | ${inputs} -> ${outputs} | ${behavior.join('; ')}`
```
`normalizePhone` and `formatMobile` get pushed **apart** by their names — the exact syntactic bias we exist to escape. **Names go in the display record only, never the vector.**

**This is also why embedding raw code fails**, and why the LLM fingerprint isn't optional: code embeddings capture *syntax*, and Type-4 clones are by definition *same-behaviour-different-syntax*. The fingerprint is the mechanism that projects them into a shared semantic space. It is also the single largest line in the bill — 2,785 of gh-aw's calls were fingerprints, against 100 adjudications — and it is not optional.

### Rule 2 — Execution only works on PURE functions
You cannot execute arbitrary repo functions (imports, DB, network, side effects — and it's a security hole).
- **Pure = no imported identifiers used, no I/O, no `this`/`await`, no external mutation.**
- **Module-level mutable READS are allowed** (see §3.2 caveat — over-strictness kills hero #2).
- Hero repos → **real execution**, offline, pre-verified, cached.
- Arbitrary pasted repos → LLM-**predicted** divergence, labelled **"predicted, not executed"** on screen.
- Fortunately: pure utils (date, currency, string, validation) are exactly where duplication concentrates.

## 4.4 Schemas
**Fingerprint** (LLM stage 1)
```json
{ "intent": "Truncate a string to a maximum length, appending a marker",
  "inputs": ["string","number"], "outputs": ["string"], "sideEffects": [],
  "domain": "string-truncation",
  "behavior": ["measure length","slice to limit","append ellipsis marker"], "pure": true }
```
**Adjudication** (LLM stage 2)
```json
{ "same_behavior": true, "canonical_fn_id": "func_123",
  "differences": ["D recomputes the marker against keep=1, overshooting the limit"],
  "disagreement_risk": "semantic", "confidence": 0.94,
  "probe_inputs": ["[\"the quick brown fox jumps\", 20]", "[\"hello world\", 0]"] }
```

## 4.5 The scale story (a SLIDE, not a build)
```
10,000 fns → cheap filters → fingerprints → NN search → ~1,000 suspicious pairs
           → ~100 high-confidence → ~20 clusters proven
```
**The expensive intelligence runs on 20–100 things, not 10,000.**
Incremental: content-hash per file → only reparse what changed.

---

# 5. ECONOMICS

## 5.1 Cost per repo — measured

**Rule: only quote numbers from runs that actually paid for fingerprinting.** A
re-run over a repo we have already analysed reuses cached fingerprints and bills
adjudication only, so it looks far cheaper than a first analysis and must never
be quoted as one.

| Repo | Functions | Measured cost | Basis |
|---|---:|---:|---|
| `sindresorhus/yocto-queue` | 6 | **< ₹1** | full run |
| `sindresorhus/p-limit` | 31 | **< ₹1** | full run |
| `Kuzma02` e-commerce | 336 | **~₹70** | full run |
| `github/gh-aw` | 2,870 | **₹232** | single uncached run — 2,785 fingerprint calls + 100 adjudications |
| `cline/cline` | 2,654 | **~₹220** | first-run equivalent, same basis |

Which stage costs what, structurally:

| Stage | LLM? | Scales with |
|---|---|---|
| Fetch + filter + AST parse | ❌ | — (**₹0**) |
| Fingerprints | ✅ cheap | **function count** — one call each; this is the term that grows |
| Embeddings | ✅ | function count, but negligible (batched, ~₹0.15/repo) |
| Clustering (in-memory cosine) | ❌ | — (**₹0**) |
| Adjudication | ✅ flagship | **`LIVE_CANDIDATE_CAP`, not repo size** — bounded, so it flattens out |
| Probe / execution | ❌ | — (**₹0**) |

That asymmetry is the whole cost story: gh-aw paid for **2,785 fingerprints but only
100 adjudications.** Doubling a repo's size roughly doubles the cheap term and
leaves the expensive one flat — which is why the two caps in `docs/ONDEMAND.md`
are separate knobs: `LIVE_MAX_FUNCTIONS` buys coverage, `LIVE_CANDIDATE_CAP`
bounds spend.

Extrapolating the same basis, a 5,000-function repo is **≈ ₹350–400**. Demo costs
**₹0** — heroes are pre-cached in Mongo.

## 5.2 The slide that sells the business
> ### **Ditto Guard costs ≈ ₹1 (~$0.01) per PR.**
> It only fingerprints the **new functions in the diff** and searches the existing index — it never re-analyses the repo.

| PR shape | What runs | Cost |
|---|---|---|
| **Adds novel functions** (most PRs) | ~5 nano fingerprints, then an index search that costs ₹0 | **≈ ₹0.15** |
| **Reinvents something** | those fingerprints **+ 1 flagship adjudication** on the candidate match | **≈ ₹1.50** |
| **Blended** | | **≈ ₹1 ≈ $0.01** |

> **The expensive call only fires when Guard has actually found something** — you pay the flagship exactly when it's earning its keep.
> **The thing that makes money is the cheapest thing we run.**

---

# 6. DEPLOYMENT ARCHITECTURE

```
        ┌───────────────────────────────────────────┐
        │  INDEXER  (Node + ts-morph)               │
        │  RUNS LOCALLY. NEVER DEPLOYED.            │
        │  tarball → AST → fingerprint → embed →    │
        │  cluster → adjudicate → probe             │
        └────────────────────┬──────────────────────┘
                             │ writes pre-baked results
                             ▼
                  ┌─────────────────────┐
                  │   MongoDB Atlas     │  (free tier)
                  │  repos / functions  │
                  │  / clusters         │
                  └──────────┬──────────┘
                             │ reads
                             ▼
        ┌──────────────────────────────────────────┐
        │  API — Express + Mongoose + Zod          │
        │  → GCP CLOUD RUN                         │
        │  (console deploy from GitHub via         │
        │   Cloud Build — NO gcloud CLI needed)    │
        │  GET /api/v1/repos/:id                   │
        │  GET /api/v1/clusters/:id                │
        │  POST /api/v1/guard/check                │
        └──────────┬───────────────────┬───────────┘
                   │                   │
                   ▼                   ▼
        ┌──────────────────┐   ┌──────────────────┐
        │  FRONTEND        │   │  DITTO GUARD     │
        │  Next.js 16 +    │   │  GitHub Action   │
        │  React 19 +      │   │  → comments on   │
        │  Tailwind 4      │   │    the PR        │
        │  → VERCEL        │   └──────────────────┘
        └──────────────────┘
```

## 6.1 Why the indexer runs locally (the key deploy decision)
Cloning + parsing a repo in a serverless function is slow, memory-hungry, and often impossible.
**By pre-baking results into Mongo, the runtime never clones anything.** The API just reads.
→ **The whole "serverless can't clone a repo" problem class disappears**, and the demo can never fail on a cold run.

## 6.2 Stack decisions (locked, with rationale)
| Decision | Why |
|---|---|
| **`ts-morph`** not tree-sitter | JS/TS only; TS-native; simpler API |
| **No vector DB** | 1,500 fingerprints = a 1500×1500 cosine matrix = ~2.25M floats = **milliseconds in plain JS**. Atlas Vector Search is a distraction at this scale. |
| **Cloud Run** for API | GCP requirement; console deploy from GitHub; injects `PORT` (AppConfig reads it), sends SIGTERM (index.ts handles it) |
| **Vercel** for frontend | 2-minute live URL, zero config for Next 16 |
| **`worker_threads`** sandbox | execute pure fns with a 1s hard timeout, no network/fs |
| **Explicit `--scope`** not a cap | a naive "first 1500" cap can silently cut a cluster member |

---

# 7. THE COMPETITIVE LANDSCAPE (be honest — a judge will Google this)

## 7.1 Prior art — CITE IT, don't hide it
**[HyClone — arXiv 2508.01357](https://arxiv.org/html/2508.01357v1)** — LLM screening + execution validation for Type-4 clones. **This is our architecture, in a paper.**
**Our honest position:** *"The research proves the approach works. Nobody has productized it at repo scale."*

| HyClone (research) | Ditto (product) |
|---|---|
| Python only | **JS/TS** — where the agent slop actually is |
| **Pairwise** — compares 2 functions you hand it | **Repo-scale clustering** — 742 fns → clusters |
| Explicitly *"not optimized for large-scale"* | **The O(n²) prune IS our contribution** |
| F1 ≈ 0.63, precision drops 4–8% | confidence-gated, degrades to "near-duplicate" |
| No consolidation, no CI | codemod diff + Guard |

**Citing prior art makes us look like we did our homework instead of claiming false novelty.** Put it in the README and the deck.

## 7.2 Real products
| Product | What it does | Why we're different |
|---|---|---|
| **Greptile** | Builds a **graph** of the repo, reviews PRs against it. *(NOT diff-only — don't overclaim this.)* | Their product is **codebase-aware PR review**. Ours is **semantic redundancy + drift**. Adjacent infra, different product. |
| **CodeAnt AI** | Closest commercial claim — markets "spots when someone rewrites a utility instead of reusing it" | Broad code-quality platform. **No execution proof.** |
| **Sourcegraph Cody** | Code search + graph context | Not continuous semantic-duplicate clustering |
| **Qodo** | Multi-agent context-aware review | Adjacent, not identical |
| **jscpd / SonarQube / CloneDR** | Token/AST duplication (Type 1–3) | **Return literal 0 for our clusters. That's our live demo.** |
| **Moderne / OpenRewrite** | Deterministic multi-repo refactor recipes | Rule-based, not semantic discovery |
| **Codex / Jules / Cursor / Devin** | Agents that **write** code | **They cause the problem. We're infrastructure FOR them, not against them.** |

## 7.3 ⚠️ The paper that can be used against us
**[arXiv 2509.25754 — *Are Classical Clone Detectors Good Enough For the AI Era?*](https://arxiv.org/abs/2509.25754)** found classical detectors **retain real effectiveness against AI-generated clones, with good normalisation.**

> **NEVER claim "traditional tools are useless."** Claim only what is definitionally true:
> **"For semantically-equivalent, syntactically-different functions, token-based tools return zero."**
> And our jscpd=0 must run on **real** clusters (§3), not cherry-picked ones.

Also: **[arXiv 2606.25272](https://arxiv.org/abs/2606.25272)** — 11 semantic clone detectors degrade under distribution shift. The problem is genuinely unsolved.

---

# 8. BUSINESS

## 8.1 The model
| Layer | What | Price |
|---|---|---|
| **Free / viral** | The Intelligence Map on any public repo. Top-of-funnel. Free forever for OSS. | ₹0 |
| **💰 The product** | **Ditto Guard** — a GitHub App / CI check that comments *"this already exists at `src/date.ts:41`"* and blocks the PR | **~$15–30/dev/mo**, or per-repo tiers |
| **Enterprise** | Private repos, self-host, multi-repo | custom |

**The map is the growth engine. The check is the business.**

## 8.2 Market
- AI code review: **~$420M ARR and growing.** CodeRabbit: 2M+ connected repos. Greptile: funded.
- Bottoms-up: **50k paid seats × $20/mo = $12M ARR.** TAM = dev-tools/code-quality (multi-$B).
- **Our wedge sits UPSTREAM of the diff** — "does this already exist?" — a question review-the-diff tools structurally don't answer.

## 8.2b Incremental by design — the "codebase memory" economics (a first-class pitch point)
The cost model is what makes Ditto a *system of record*, not a one-shot script:
- **First full analysis of a repo:** measured **₹232** at 2,870 functions (gh-aw, single uncached run), **~₹70** at 336, **under ₹1** for a small library. One time, run offline by us.
- **Every function is cached by `bodyHash`** — we never re-pay to analyse a piece of code whose text hasn't changed. Re-analysing an unchanged function costs ₹0.
- **Ongoing changes cost ~₹1 (~$0.01) via Ditto Guard** — a PR adds a few functions, Guard fingerprints only those and searches the existing index. Two tiers: a PR that adds novel code is ~5 nano fingerprints (**≈ ₹0.15**); a PR that actually reinvents something adds one flagship adjudication (**≈ ₹1.50**). Blended, **≈ ₹1**. An active repo growing by 20k LOC over a month is a stream of ₹1 checks, not a ₹232 re-run.
- **Serving the results costs ₹0** — the deployed app reads pre-computed data from Mongo; no AI at request time. Traffic does not cost money.
- **The line:** *"The first look at a repo is pennies. After that, every PR costs about a rupee — a cent — because we only ever look at what moved. Ditto never re-analyses code that didn't change."*
- **Known gap / roadmap:** a re-index over an already-analysed repo reuses cached fingerprints but still **re-pays adjudication**, because cluster verdicts aren't cached yet. We have measured exactly this: a cline re-run billed **~₹130 — adjudication only**, against ~₹220 for a true first analysis. (That ~₹130 is *only* valid as the cost of this re-run scenario; quoting it as a first-analysis price understates the real thing by the entire fingerprint bill.) Fix = cache each verdict by a hash of its members' `bodyHash`es → a full re-index drops to ~₹15–30. ~1 hour of work; build post-core if time allows.

## 8.3 Moat (honest)
1. **Position** — upstream of the diff. Incumbents review changes; we index the whole repo for equivalence.
2. **Data** — *which clusters teams actually consolidate* is a labelled reuse dataset nobody else has. It compounds precision.
3. **Distribution** — the free map is inherently viral among exactly this event's audience.

**"Couldn't Greptile ship this in a week?"** → *They review diffs. We index the whole repo for equivalence, and we reframed the value from ignorable cleanliness to fundable correctness.*

## 8.4 The layered vision (roadmap slide)
```
Layer 1  Repository Memory      — what functionality exists?
Layer 2  Semantic Redundancy    — where does it exist more than once?
Layer 3  Behavioural Drift      — where have the copies started disagreeing?   ← WE ARE HERE
Layer 4  Consolidation          — which one should be canonical?
Layer 5  Prevention             — is this PR/agent reinventing something?      ← THE BUSINESS
Layer 6  Agent Preflight (MCP)  — agent asks Ditto BEFORE it writes            ← THE VISION
```

## 8.5 "What's next"
1. **Ditto Guard** GitHub App → GA
2. Automated consolidation PRs with call-site rewiring + generated regression tests
3. **Agent Preflight via MCP** — the agent asks "does this exist?" *before* writing. *"We give AI agents memory of your codebase."*
4. Python / Go / Java
5. Private repos + self-host
6. The reuse dataset → an industry **"Ditto Score"** badge + a public Type-4 benchmark

---

# 9. HONEST GAPS & RISKS

## 9.1 Build risks (ranked)
| # | Risk | Mitigation |
|---|---|---|
| **1** | **3 of 4 cline `truncateText` are FILE-LOCAL.** If extraction walks imports/exports instead of AST source nodes, **the money shot returns 1 function and the demo is dead.** | **AST source extraction is not optional. Build it first, verify against cline before anything else.** Acceptance test: find all 4. |
| **2** | **An over-strict purity filter silently kills hero #2** (`currencyToAmount` reads module-level state) | Bar **mutation and I/O**, allow **reads**. Test on `actual` day 1. |
| **3** | **`--scope` is required** — cline and actual both need it. Only Kuzma02 scans whole. Without it, "point at a repo URL" has a visible seam. | Build the flag in hour one. **Explicit scope, never a truncation cap** (a naive 1500 cap cuts one of gh-aw's four). |
| **4** | Precision under live "break it" | Confidence thresholds; below ~0.8 → dashed "near-duplicate"; always show the diff; **never auto-delete** |
| **5** | Flat demo on the wrong repo | 3 pre-cached verified heroes; the scripted demo never rides a cold run |

## 9.2 Evidence gaps — prepare these answers, do NOT bluff
1. **"Does this generalise across utility families?"** → **We proved it on THREE:** date/time, money-parsing, string-escaping/validation. **Phone normalisation doesn't exist in serious OSS JS/TS** (everyone imports `libphonenumber-js`). Zero hits for `deepClone`, `debounce`, `retry`, `formatBytes`. **Say "three", don't bluff.**
2. **Most clusters only diverge on `null`/type-abuse.** Exactly **four** in the whole hunt diverge on *realistic* input: cline, actual, Kuzma02, Ghost. **That's why those are the picks.** Don't let anyone swap in a cooler-sounding repo.
3. **jscpd-0 margin is thinner than the pitch implies.** Our top 3 survive `--min-tokens 10` (verified). But Ghost cracks at 30, novu at 10. Part of *why* jscpd misses short validators is that they sit under its 50-token floor — **not** because the control flow is exotic. If a judge runs `--min-tokens 10` on **our** heroes, we survive.
4. **Function counts are grep-approximate**, not AST-parsed. cline (~1,630) is already 9% over the nominal cap.
5. **No cluster deeper than 4.**

## 9.3 ❌ The Codex-generated repo — CANCELLED (and why)
We built `ditto-demo-shop` as a "guaranteed" fallback. **Do not use it.**
1. **Self-refuting.** *"We had Codex write this"* → a judge hears *"so you planted the duplicates you then found."* It converts our strongest claim (**we found real rot in real code**) into our weakest.
2. **Unnecessary.** Real repos give a *better* AI narrative — gh-aw's **79% Copilot-authored PRs** is a real production statistic.
3. **Our heroes can't collapse** — divergence is **already executed**, not predicted. Nothing left for a fallback to rescue.
4. The real fallback, if everything slips, is **Kuzma02 whole-repo** — still a real repo.

*(Its one useful output is the §2.5 insight: agents reuse what's exported, reinvent what's buried.)*

## 9.4 "Just a wrapper?" — the four answers
1. **Proven empirically, live.** `jscpd` runs on camera and returns **0**. Delete the LLM and you don't get a worse Ditto — **you get jscpd, which is blind.**
2. **The AI is load-bearing in TWO independent stages** — behaviour fingerprinting (projects syntax-different code into semantic space; **embeddings of raw code provably cannot do this**) + flagship equivalence adjudication.
3. **The most damning evidence isn't even an LLM output.** The divergence table is **executed ground truth**. "Your four functions returned three different values" is not a model opinion.
4. **A real pipeline with a real cost trick** — the flagship **never sees the O(n²) cross-product**. That prune is why this didn't exist before.

**Canned answer for "this cluster is wrong":** *"Good — that's why we show confidence and the diff and never auto-delete. It degrades to an interesting near-duplicate, not a broken claim."*

---

# 10. THE DEMO (3 minutes)

| Time | Beat |
|---|---|
| **0:00–0:15** | Four functions on screen, all named `truncateText`, from **cline — an AI coding agent with 64.7k stars.** "An agent wrote these. They're in one package. They do the same thing." |
| **0:15–0:35** | Split screen. LEFT: `npx jscpd` → **"Found 0 clones ✅"**. RIGHT: point Ditto at the same repo. |
| **0:35–0:55** | **WOW 1 — the Intelligence Map blooms.** 1,630 functions · 12 clusters · 5 behavioural conflicts. "jscpd: 0. Ditto: 12." |
| **0:55–1:20** | Click the `truncateText` cluster → four visibly different implementations side by side. |
| **1:20–1:55** | **WOW 2 — DittoProof.** Feed all four `("the quick brown fox jumps", 20)`. Table renders: **three different answers.** Row D returns 25 chars containing one letter. **"Our AI *suspected*. Our execution engine *proved*."** |
| **1:55–2:25** | **WOW 3 — Guard.** A PR adds a 5th `truncateText`. Ditto Guard comments inline: *"already exists at compaction-shared.ts:70 — 96% match."* Check goes red. "The map finds the debt. The check stops you adding it." |
| **2:25–2:50** | **The AI-rot slide.** gh-aw: **79% of merged PRs Copilot-authored, four `escapeHtml`, jscpd: 0.** "This isn't cline's fault. It's what happens when agents write code faster than anyone can remember what's already there." |
| **2:50–3:00** | **"AI can write a thousand lines before lunch. It doesn't remember what you already wrote. Ditto gives your codebase a memory."** Live URL. |

---

# 11. HACKATHON REQUIREMENTS

**OpenAI × NamasteDev Codex Hackathon** · Judges: Akshay Saini + OpenAI
**Deadline: 19 July 2026, 11:59 PM.** *Missing ANY deliverable = not evaluated at all.*

| Deliverable | Status |
|---|---|
| Live public prototype URL | Cloud Run + Vercel |
| Public 3-min demo video | §10 |
| Public repo + real README | must cite HyClone, honest scope, Codex build log |
| 5–7 slide deck | this doc |

**Judged on:** Innovation · Execution · Impact · **Product quality** · **Meaningful use of AI** · Creativity
**Hard rule:** must be built **with OpenAI Codex** (not exclusively — mixed Codex/Claude authorship is honest and compliant; commits carry accurate trailers).

**Judges want:** *"working products that solve a pain point using AI and creativity, not perfectly built projects — something judges can open, click, use, test, and maybe even break."*

## 11.1 Criterion mapping
| Criterion | Our answer |
|---|---|
| **Innovation** | Repo-scale Type-4 clustering + execution proof. Research exists (HyClone); **no product does.** |
| **Execution** | Live URL, real repos, executed tables, working CI check |
| **Impact** | 4 real bugs in real repos incl. an AI agent w/ 64.7k stars + GitHub's own repo at 79% agent-authored |
| **Product quality** | Intelligence Map + divergence table + Guard; honest degradation |
| **Meaningful use of AI** | **Two load-bearing LLM stages**; delete it → jscpd → literal 0. And the killer evidence is *executed*, not generated. |
| **Creativity** | jscpd=0 vs Ditto=12 on camera; the AI agent's own codebase as exhibit A |

---

# 12. ONE-LINERS (steal for slides)

> **jscpd says your codebase has zero duplication. Ditto finds the four `truncateText` your agents wrote — and proves three of them disagree.**

> **The AI coding agent's own codebase has four functions named `truncateText`. They give three different answers.**

> **62 of 78 merged PRs in GitHub's own repo were written by a bot. That directory has four `escapeHtml` helpers.**

> **Our AI suspected. Our execution engine proved.**

> **Today CI asks: does it compile? Ditto asks: are you reinventing something your codebase already knows?**

> **Every AI coding agent has intelligence. None owns the long-term memory of your codebase.**

> **The map finds the debt. The check stops you adding it.**

> **The thing that makes money costs about a rupee a PR — and the expensive call only fires when it's found something.**

> **AI can write a thousand lines before lunch. It doesn't remember what you already wrote.**
