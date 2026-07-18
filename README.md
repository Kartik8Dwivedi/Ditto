# Ditto — Semantic CI

**Find functions that do the same thing but are written completely differently — then execute them to prove they disagree.**

> Today CI asks: *does it compile? do tests pass? does lint pass?*
> **Ditto adds: *are you reinventing something your codebase already knows?***

🔗 **Live demo:** `<LIVE_FRONTEND_URL>` · **API:** `<LIVE_API_URL>` · **Demo video:** `<VIDEO_URL>`

---

## The 15-second version

We pointed Ditto at [**cline**](https://github.com/cline/cline) — an AI coding agent with 64,000+ stars. Inside a single package, it found **four functions named `truncateText`**, and proved two of them silently disagree:

```
truncateText("abcdefghijklmnopqrstuvwxyz", 20)

  compaction-shared.ts:70   →  "abcdefghijklmnopqrst\n...[truncated 6 chars]"   (keeps 20 chars — correct)
  budget-projection.ts:329  →  "a\n...[truncated 25 chars]"                     (keeps 1 char — BROKEN)
```

`jscpd` — the standard duplicate detector — reports **0 clones** on these files. They look nothing alike. But they're supposed to do the same job, and one is silently broken: for any limit above 16, `budget-projection` reserves so much space for its truncation notice that it keeps a **single character**. Ditto extracted both, executed them on the same inputs, and proved the disagreement with real output — not a model's opinion.

---

## The problem

AI coding agents don't read your whole codebase before writing — at scale, they can't. So they re-implement what already exists, under a different name, in a different file. Over time you accumulate functions that are *supposed* to agree and don't. Your tests pass, because each one is correct in isolation.

- **More than 1 in 5 code reviews now involve an AI agent** (GitHub).
- Peer-reviewed work finds agents produce *more* semantically-duplicate code than humans — **and** that reviewers are *less* critical of AI-authored PRs. The problem grows exactly as oversight drops.

These are **Type-4 clones** — same behaviour, completely different implementation. They are, by definition, the clones that token- and AST-based tools (jscpd, SonarQube, CPD) return **zero** for.

| Clone type | Example | Caught by existing tools? |
|---|---|---|
| Type 1–3 | copy-paste, renamed vars, small edits | ✅ yes |
| **Type 4** | **same behaviour, different code** | ❌ **nothing — returns 0** |

---

## How it works

**The core principle: the LLM never sees your codebase. It sees one function at a time.** Context per call is tiny and constant — it does not grow with repo size. Only the *number* of cheap calls grows, handled by a cheap model, concurrency, and content-hash caching.

```
GitHub tarball → filter → ts-morph AST (every function, incl. non-exported)
   ↓  deterministic, 0 tokens
fingerprint   (cheap model, 1 function/call)   behaviour, name-blind, cached by bodyHash
   ↓
embed the fingerprint  (never the code, never the name)   — the whole thesis
   ↓
cluster   (in-memory cosine, 0 tokens)   O(n²) dies here; the flagship never sees the cross-product
   ↓
adjudicate  (flagship, 1 cluster/call)   equivalence + adversarial probe inputs; rejects non-equivalents
   ↓
probe   (worker_threads sandbox, 0 tokens)   executes PURE members only → executed ground truth
```

Two decisions make it work, and one makes it *ours*:

1. **We embed the function's behaviour, never its name or raw code.** `normalizePhone` and `formatMobile` would be pushed apart by their names — the exact syntactic bias we exist to escape. Embedding raw code fails for the same reason: Type-4 clones are, by definition, syntactically different.
2. **We only execute pure functions** (no I/O, no side effects), in a sandbox. The divergence table is *executed ground truth*, not a prediction.
3. **We rank candidates by cross-module reinvention, not similarity.** Type-4 clones have *lower* similarity by nature, so a naive tool spends its budget on near-exact copies jscpd already catches — and starves the semantic clones that are the whole point. **Ditto deliberately looks where the other tools can't.**

---

## What Ditto found in cline (real, from the live pipeline)

| Metric | Value |
|---|---|
| Functions analysed | 2,654 |
| Files / modules | 209 / 51 |
| Semantic duplicate clusters | 71 |
| Behavioural conflicts | 50 |
| **Proven divergences (executed)** | **11** |
| Ditto health score | 52 / 100 |

And it *reasoned*, rather than name-matched: the four `truncateText` did not naively lump together. Ditto split them into two genuine duplicate pairs and correctly **excluded** two near-misses — one that secretly normalises whitespace (does extra work) and one that operates on structured content (different job entirely).

---

## Honest scope & limitations

We would rather tell you than have you find out:

- **JavaScript / TypeScript only.** The AST layer is `ts-morph`.
- **We proved divergence on three utility families** — string truncation, money parsing, email validation. Not eight. (Phone normalisation, for instance, barely exists in serious OSS JS — everyone imports `libphonenumber-js`.)
- **Execution requires pure functions.** Impure functions (I/O, network, DB) are clustered and adjudicated but not executed — their divergence is shown as *predicted*, clearly labelled, never as executed.
- **Large repos are scoped**, not truncated — an explicit `--scope` subtree, so a cluster member is never silently dropped.
- Clusters with proven divergence are framed as **conflicts to resolve**, never with a "keep this one" recommendation — because when two implementations disagree, a human must choose.

## Prior art

This approach has research precedent, and we cite it rather than claim false novelty. **[HyClone (arXiv 2508.01357)](https://arxiv.org/abs/2508.01357)** demonstrated LLM-screening + execution-validation for Type-4 clones. It is a Python-only, *pairwise* research prototype, explicitly "not optimised for large-scale." Ditto's contribution is the productisation: **repo-scale clustering** (the O(n²) prune), JS/TS, the cross-module ranking, and a consolidation/CI loop. We also note [arXiv 2509.25754](https://arxiv.org/abs/2509.25754) — classical detectors remain effective on AI clones *with good normalisation*, which is why our claim is precise: token-based tools return zero for **syntactically-different equivalents**, not for all AI-generated code.

---

## Tech stack

- **Indexer + pipeline:** Node, `ts-morph`, runs locally, writes to MongoDB Atlas. Never deployed — so the runtime never clones a repo, and the demo can't fail on a cold run.
- **API:** Express + Mongoose + Zod → Google Cloud Run.
- **Frontend:** Next.js 16 + React 19 + Tailwind 4 → Vercel.
- **Models:** OpenAI `gpt-5.4-nano` (fingerprints), `gpt-5.6-terra` (adjudication), `text-embedding-3-small`. Structured Outputs throughout — every LLM response is Zod-validated; no free-text JSON parsing anywhere.

Cost is ~₹50–135 to fully analyse a repo *once*, offline. Serving the results costs **₹0** — the deployed app reads pre-computed data.

## Run it locally

```bash
# Backend
cd backend
cp .sample.env .env          # set MONGO_URI, OPENAI_API_KEY
npm install
npm run index -- cline/cline --scope sdk/packages/core   # local, no cost
npm run pipeline -- cline/cline                            # fingerprint→…→probe→Mongo
npm run dev                                                # serve the read API

# Frontend
cd ../frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:3001 npm run dev
```

## How we built this

Built with **OpenAI Codex** and **Claude** in tandem, over the hackathon window. Codex authored the repo conventions (`AGENTS.md`) and frontend scaffold; the pipeline, product, and UI were built across dedicated agent sessions. Commit history reflects the mixed authorship honestly. Every number and code output in this README was executed or read from real source — nothing here is illustrative.

---

*OpenAI × NamasteDev Codex Hackathon, July 2026.*
