<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="frontend/public/logo/ditto_dark_bg.png">
    <source media="(prefers-color-scheme: light)" srcset="frontend/public/logo/ditto_white_bg.png">
    <img alt="Ditto Logo" src="frontend/public/logo/ditto_white_bg.png" width="300" />
  </picture>
</p>

<h1 align="center">Ditto — Semantic CI</h1>

<p align="center">
  <strong>Find functions that do the same thing but are written completely differently —<br/>then execute them to prove they disagree.</strong>
</p>

<p align="center">
  🔗 <a href="https://ditto-flax.vercel.app"><strong>Live demo</strong></a> ·
  <a href="https://ditto-backend-1016629498190.asia-south2.run.app">API</a> ·
  <a href="#run-it-yourself">Run it yourself</a> ·
  <a href="#contribute">Contribute</a>
</p>

---

## You've had this code review

You ship a feature. Cursor wrote most of it, or Copilot, or Codex. It works, tests pass, you open the PR.

Your manager leaves a comment: *"we already have a helper that does this."*

Mildly embarrassing. You delete your version, import theirs, move on. No harm done.

**The worse case is when nobody notices.**

Because now there are two functions that are supposed to behave identically. They live in different files, under different names, written in different styles. Nobody knows they're related. So when someone fixes an edge case in one of them — the empty string, the off-by-one, the negative number — the other one doesn't get the fix. The two quietly drift apart.

Six months later, one of them is wrong in production. No test catches it, because each function is perfectly correct in isolation. They're only wrong *relative to each other*, and nothing in your toolchain has any concept of that.

Here's the twist: **"do we already have something that does this?" is exactly the check nobody runs.** Not because it isn't worth doing — because doing it properly means comparing every function against every other function, and doing that with an LLM costs more than the feature is worth. So it never gets done. The check that would catch this is the one the economics forbid.

**That's the gap Ditto closes.**

---

## What Ditto is

**Semantic CI.** Your pipeline already asks *does it compile, do tests pass, does lint pass*. Ditto adds one more question:

> **Are you reinventing something your codebase already knows?**

It works in two directions:

- **Detection** — point it at a repo you already have. It finds the duplicate families hiding in there and, where the functions are pure, *executes* them side by side to prove which ones disagree.
- **Prevention** — the same index answers "does this already exist?" for new code, at roughly a rupee per pull request. (In progress — see [Roadmap](#roadmap).)

These are **Type-4 clones**: same behaviour, completely different implementation. They are, by definition, the clones that token- and AST-based tools cannot see.

| Clone type | Example | Caught by jscpd / SonarQube / CPD? |
|---|---|---|
| Type 1–3 | copy-paste, renamed variables, small edits | ✅ yes |
| **Type 4** | **same behaviour, different code** | ❌ **returns zero** |

---

## The proof

We ran Ditto across five real repositories — two large AI/agent codebases, a full-stack e-commerce app, and two small, well-maintained utility libraries. Every number below was read from the live database, not estimated.

| Repository | Functions | Duplicate clusters | Behavioural conflicts | **Proven by execution** | Health |
|---|---:|---:|---:|---:|---:|
| [github/gh-aw](https://github.com/github/gh-aw) | 2,870 | 68 | 48 | **5** | 57 / 100 |
| [cline/cline](https://github.com/cline/cline) | 2,654 | 71 | 50 | **11** | 52 / 100 |
| [Kuzma02/Electronics-eCommerce-Shop](https://github.com/Kuzma02/Electronics-eCommerce-Shop-With-Admin-Dashboard-NextJS-NodeJS) | 336 | 24 | 14 | **2** | 0 / 100 |
| [sindresorhus/p-limit](https://github.com/sindresorhus/p-limit) | 31 | 0 | 0 | 0 | **100 / 100** |
| [sindresorhus/yocto-queue](https://github.com/sindresorhus/yocto-queue) | 6 | 0 | 0 | 0 | **100 / 100** |
| **Total** | **5,897** | **163** | **112** | **18** | — |

The two libraries at the bottom matter as much as the findings at the top. **A tool that finds problems everywhere is a tool that's hallucinating.** Ditto looked at two small, carefully-maintained libraries, found nothing wrong, and said so — scoring both a clean 100. The scale spans its full range on real inputs, which is what makes the 52s and 57s worth reading.

### The money shot: four `truncateText`, one of them broken

Inside cline's core package, Ditto found **four functions named `truncateText`** — three of them private to their file, which is why enumerating exports finds one of four and the whole family stays invisible.

It did not naively lump them together. It split them into two genuine duplicate pairs based on behaviour. Then it executed one pair on the same inputs:

```
truncateText("abcdefghijklmnopqrstuvwxyz", 20)

  compaction-shared.ts:70            →  "abcdefghijklmnopqrst\n...[truncated 6 chars]"
                                        keeps 20 characters — correct

  budget-projection/project.ts:329   →  "a\n...[truncated 25 chars]"
                                        keeps 1 character — broken
```

Both are pure functions. Ditto lifted them out of the repo, ran them in a sandbox on identical inputs, and recorded what actually came back. **This is executed output, not a model's opinion.**

The bug is a reserved-space calculation: `budget-projection` subtracts the length of its own truncation notice from the budget, and once the limit exceeds 16 the notice eats the entire allowance, leaving a single character. Ditto generated the boundary inputs itself — 0, −1, 5, 16, 17, 20 — and the pair agrees at 16 and diverges at 17. It found the exact edge without being told where to look.

`jscpd` reports **0 clones** across these files. They share almost no tokens. But they're supposed to do the same job, and one of them is silently wrong.

---

## Why it's cheap enough to be real

The obvious way to build this is to show an LLM your codebase and ask what's duplicated. That fails twice: context windows aren't big enough, and comparing n functions pairwise is O(n²) calls. At 2,654 functions that's over three million comparisons. Nobody is running that.

**So the LLM never sees your codebase. It sees exactly one function at a time.**

```
GitHub tarball → filter → ts-morph AST (every function, including non-exported)
   ↓  deterministic · 0 tokens
fingerprint       cheap model · 1 function per call · name-blind · cached by body hash
   ↓
embed the fingerprint      never the code, never the name  ← the whole thesis
   ↓
cluster           in-memory cosine similarity · 0 tokens   ← O(n²) dies here, for free
   ↓
adjudicate        flagship model · 1 cluster per call · proposes adversarial inputs
   ↓
probe             worker_threads sandbox · 0 tokens        ← executed ground truth
```

Context per call is **tiny and constant** — it does not grow with repo size. Only the *number* of cheap calls grows, and those are handled by a nano-tier model, concurrency, and content-hash caching that makes re-runs nearly free. The expensive flagship model only ever sees a handful of pre-filtered candidate clusters, never the cross-product.

Three decisions make it work:

1. **We embed behaviour, never names or raw code.** `normalizePhone` and `formatMobile` would be pushed apart by their names — the exact syntactic bias we exist to escape. Embedding raw code fails identically, since Type-4 clones are syntactically different by definition.
2. **We only execute pure functions.** No I/O, no side effects, sandboxed, with a timeout. Impure functions still get clustered and adjudicated, but their divergence is labelled *predicted* and never dressed up as executed.
3. **We rank candidates by cross-module reinvention, not by similarity.** Type-4 clones have *lower* similarity by nature, so ranking on similarity spends the budget on near-exact copies jscpd already finds and starves the semantic clones that are the entire point. Ditto deliberately looks where the other tools can't.

**What it actually costs**, measured across the five runs above:

| | Cost |
|---|---|
| Analyse a repo **once**, offline | **₹50 – ₹230** depending on size |
| **Serve** the results, forever | **₹0** — the deployed app reads pre-computed data |
| Each pull request afterwards | **~₹1 (~$0.01)** (roadmap) |

The analysis is a one-time cost you pay per repo. The demo cannot fail live or run up a bill, because serving it touches no model at all.

The per-PR figure is two-tiered, and worth stating plainly rather than as a single blended claim. Most PRs add genuinely novel functions: Ditto Guard fingerprints those (~5 cheap calls, **≈ ₹0.15**) and searches the existing index, which costs nothing. When the search *does* surface a candidate match, one flagship adjudication runs on it — **≈ ₹1.50** for that PR. Blended across real traffic that lands at **≈ ₹1 (~$0.01)**. The expensive call only fires when Guard has actually found something.

---

## About the hosted demo

The [live demo](https://ditto-flax.vercel.app) caps on-demand analysis at **600 functions per repository.**

To be straight with you: **that is a limit on our OpenAI credits, not on the product.** We're a small team paying for this out of pocket, and the paste-a-URL box is open to the internet. The cap is what keeps it open at all.

The pipeline itself has no such limit — the cline and gh-aw numbers above are full runs at 2,654 and 2,870 functions, produced by exactly the same code path. Both caps are single environment variables (`LIVE_MAX_FUNCTIONS`, `LIVE_CANDIDATE_CAP`); nothing is special-cased.

**Run it locally with your own key and there is no cap.** That path is documented below, and we've tried to make it complete enough that you never have to ask us a question.

---

## Run it yourself

### Prerequisites

| | |
|---|---|
| **Node.js 22+** | The backend is native ESM and the Docker image is `node:22-alpine`. |
| **MongoDB** | A [free Atlas M0 cluster](https://www.mongodb.com/cloud/atlas/register) is plenty. Local `mongod` works too. |
| **OpenAI API key** | Only needed for `npm run pipeline`. Indexing and serving need no key. |
| **GitHub token** *(optional)* | Raises the anonymous rate limit when fetching repo tarballs. |

### 1. Index a repo — free, and do this first

```bash
cd backend
npm install
npm run index -- cline/cline --scope sdk/packages/core
```

**This step needs neither MongoDB nor an API key, and costs nothing.** It downloads the repo as a tarball (no `git clone`), walks every file with `ts-morph`, and writes the extracted functions to `backend/.cache/`.

It also prints the function count — which is the number that determines your bill. **Always index before you spend.** If it reports 4,000 functions and you only wanted the core package, add `--scope` and run it again for free until the number looks right.

```
Options:
  --scope <path>     only index files under this repo-relative directory
  --branch <name>    branch or tag (default: the repo's default branch)
  --max <n>          cap functions indexed — NOT set by default, and every
                     dropped function is named in the log, because a silent cap
                     makes clusters vanish and a half-analysed repo looks clean
```

### 2. Configure the backend

```bash
cp .sample.env .env
```

| Variable | Required | What it does |
|---|---|---|
| `MONGO_URI` | **yes** | Where results are written and read from. |
| `OPENAI_API_KEY` | **yes** | Used by the pipeline, by Ditto Guard, and by on-demand analysis. The read endpoints that serve the map never call a model — validated at startup regardless, so the server fails fast rather than mid-request. |
| `PORT` | no | Defaults to `3001`. Cloud Run injects its own. |
| `CORS_ORIGIN` | no | Comma-separated origins, or `*`. |
| `OPENAI_MODEL_CHEAP` | no | Fingerprints, one call per function. Default `gpt-5.4-nano`. |
| `OPENAI_MODEL_FLAGSHIP` | no | Adjudication, one call per cluster. Default `gpt-5.6-terra`. |
| `EMBEDDING_MODEL` | no | Default `text-embedding-3-small`. |
| `GITHUB_TOKEN` | no | Raises GitHub's rate limit for the indexer. |
| `LIVE_MAX_FUNCTIONS` | no | Largest repo the **hosted** on-demand path will analyse. Default `2000`. |
| `LIVE_CANDIDATE_CAP` | no | Clusters sent to the flagship on the hosted path. Default `100`. |
| `LIVE_DEADLINE_MS` | no | Self-imposed time budget, default 18 min — below Cloud Run's 20 min timeout, so an overrun becomes an honest failed job instead of one stuck on "running". |

> Model IDs live in env on purpose. A *"model not found"* 404 is a value to change here, never a code edit.

The `GCP_PROJECT` / `TASKS_LOCATION` / `TASKS_QUEUE` / `SERVICE_URL` / `TASK_SECRET` block is only for the hosted paste-a-URL flow. **Leave it unset locally** — the job then runs inline in-process, which is exactly what you want for development.

### 3. Run the pipeline — this is the step that costs money

```bash
npm run pipeline -- cline/cline
```

Reads what the indexer cached, then: fingerprint → embed → cluster → adjudicate → probe → MongoDB.

- **Cost:** ₹50–230 depending on repo size. It prints a full token and cost breakdown per model when it finishes.
- **Time:** a few minutes for a small repo; roughly 10–15 for ~2,500 functions.
- **Re-runs are nearly free.** Fingerprints and embeddings are cached by a hash of the function body, so unchanged code is never paid for twice.

### 4. Serve it

```bash
# terminal 1 — API on :3001
cd backend && npm run dev

# terminal 2 — UI on :3000
cd frontend && npm install
cp .env.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:3001
npm run dev
```

| Frontend variable | What it does |
|---|---|
| `NEXT_PUBLIC_API_URL` | Where the backend lives. |
| `NEXT_PUBLIC_DITTO_SOURCE` | Set to `mock` to render from typed fixtures with no backend at all. Shows a visible "Fixtures" badge whenever it's on. |
| `RESTRICTED_MODE` | Shows the "hosted demo is capped" banner. Read per request, so it flips without a rebuild. |
| `LIVE_MAX_FUNCTIONS` | The cap quoted in that banner. Keep it equal to the backend's value. |

No pipeline run? `NEXT_PUBLIC_DITTO_SOURCE=mock` gives you the entire UI with zero setup.

### 5. Self-hosting

**Backend → Google Cloud Run**

```bash
gcloud run deploy ditto-backend \
  --source . \
  --region asia-south2 \
  --timeout 1200 \
  --set-env-vars "MONGO_URI=...,OPENAI_API_KEY=..."
```

Four things that will cost you an afternoon if nobody tells you:

1. **Build from the repo root, not from `backend/`.** This is a monorepo, and Cloud Build's default context is the root. The [root `Dockerfile`](Dockerfile) exists for exactly this and prefixes every path with `backend/`. There's a second Dockerfile *inside* `backend/` for local builds from that directory — using the wrong one for the wrong context fails with confusing "file not found" errors during `COPY`.
2. **Set the request timeout to 1200s.** The default 300s will kill a live analysis mid-run.
3. **Atlas IP allowlist.** Cloud Run has no static egress IP without a VPC connector, so allow `0.0.0.0/0` in Atlas Network Access and rely on the database credentials — or set up a connector with a static IP if you'd rather not.
4. **Never bake secrets into the image.** Pass them as env vars or Secret Manager references. The `.dockerignore` already excludes `.env`.

Only if you want the hosted paste-a-URL flow: create a Cloud Tasks queue in the **same region**, grant the service account **Cloud Tasks Enqueuer**, and set the `GCP_PROJECT` / `TASKS_LOCATION` / `TASKS_QUEUE` / `SERVICE_URL` / `TASK_SECRET` block. Without it everything else still works — jobs simply run inline.

**Frontend → Vercel**

Import the repo, set **Root Directory** to `frontend`, and add `NEXT_PUBLIC_API_URL` pointing at your Cloud Run URL. One gotcha: `NEXT_PUBLIC_*` variables are **inlined at build time**, so changing one in the Vercel dashboard does nothing until you redeploy. The non-public variants (`RESTRICTED_MODE`, `LIVE_MAX_FUNCTIONS`) are read per request and flip without a rebuild.

---

## Honest scope & limitations

We'd rather tell you than have you find out:

- **JavaScript / TypeScript only.** The AST layer is `ts-morph`.
- **We proved divergence on three utility families** — string truncation, money parsing, email validation. Not eight. (Phone normalisation, for instance, barely exists in serious OSS JS; everyone imports `libphonenumber-js`.)
- **Execution requires purity.** Functions touching I/O, network, or a database are clustered and adjudicated but never executed. Their divergence is shown as *predicted* and clearly labelled as such.
- **Large repos are scoped, not truncated.** You pass an explicit `--scope` subtree, so a cluster member is never silently dropped — a missing member doesn't degrade a cluster, it makes the cluster disappear, and the repo then reads as clean.
- **We never say "keep this one."** Clusters with proven divergence are framed as conflicts to resolve. When two implementations disagree, a human decides which behaviour was intended. That is not the model's call.

## Prior art

This approach has research precedent, and we'd rather cite it than claim false novelty. **[HyClone (arXiv 2508.01357)](https://arxiv.org/abs/2508.01357)** demonstrated LLM-screening plus execution-validation for Type-4 clones; it is a Python-only, *pairwise* research prototype, explicitly "not optimised for large-scale." Ditto's contribution is the productisation: repo-scale clustering (the O(n²) prune), JS/TS, cross-module ranking, and a consolidation/CI loop.

We also note [arXiv 2509.25754](https://arxiv.org/abs/2509.25754) — classical detectors remain effective on AI-generated clones *given good normalisation* — which is why our claim is deliberately precise: token-based tools return zero for **syntactically-different equivalents**, not for all AI-generated code.

---

## Roadmap

- **Ditto Guard** — the prevention half. A PR check that fingerprints only the functions the diff *adds* and asks whether the repo already knows how to do that. Costs about **$0.01 per PR**, because it never re-analyses the repo. The API endpoint exists; the GitHub Action is next.
- **Agent pre-flight via MCP** — expose the index as an MCP tool so a coding agent can ask *"does this already exist?"* **before** it writes the duplicate. Fixing the problem at the source beats catching it in review.
- **More languages** — swap `ts-morph` for `tree-sitter` and the same pipeline covers Python, Go, and Java. The AST layer is the only language-specific part; fingerprinting, clustering, and adjudication are language-agnostic.
- **Incremental re-indexing** — fingerprints are already cached by body hash, so re-analysis is nearly free. The missing piece is a CI job that re-indexes only what a commit touched.

---

## Contribute

This started as a hackathon project. It's not going to stay one.

The problem is real and getting worse: AI agents write more code every month, they can't read your whole codebase before they write, and the check that would catch the resulting duplicates is precisely the check that's too expensive to run. We think that's worth solving properly, and we don't want to leave it at a demo.

**If any of this resonates, we'd genuinely love your help.**

- **Found a false positive?** That's the most useful bug report you can file. Precision is the thing we care most about, and every wrong cluster tells us something the heuristics missed. Open an issue with the repo and cluster.
- **Ran it on your own codebase?** Tell us what it found — or what it *should* have found and didn't. Both are gold.
- **Want to write code?** The roadmap above is a good place to start. Adding a language means implementing one AST adapter; everything downstream already works. Ditto Guard needs a GitHub Action wrapper around an endpoint that already exists.
- **Not a coder?** Documentation, a clearer explanation, a better demo repo — all real contributions.

Issues and pull requests are welcome and will be read by humans who are glad you showed up. If you're unsure whether an idea fits, open an issue and ask — we'd rather have the conversation.

---

## Tech stack

- **Indexer + pipeline** — Node, `ts-morph`. Runs locally, writes to MongoDB Atlas. Deliberately never deployed, so the runtime never clones a repo and the demo can't fail on a cold start.
- **API** — Express + Mongoose + Zod → Google Cloud Run.
- **Frontend** — Next.js 16 + React 19 + Tailwind 4 → Vercel.
- **Models** — OpenAI `gpt-5.4-nano` (fingerprints), `gpt-5.6-terra` (adjudication), `text-embedding-3-small`. Structured Outputs throughout: every model response is Zod-validated, with no free-text JSON parsing anywhere.
- **Sandbox** — `worker_threads` + `vm`, no network, no filesystem, no `require`, 1-second timeout per call.

## How we built this

Built with **OpenAI Codex** and **Claude** in tandem across the hackathon window. Codex authored the repo conventions (`AGENTS.md`) and the frontend scaffold; the pipeline, product, and UI came together over dedicated agent sessions. The commit history reflects that mixed authorship honestly.

Every number and code output in this README was executed or read from the live database. Nothing here is illustrative.

---

<p align="center">
  <em>OpenAI × NamasteDev Codex Hackathon, July 2026.</em>
</p>
