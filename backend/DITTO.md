# Ditto — backend pipeline

Semantic CI. Finds functions that do the **same thing** written **completely
differently** (Type-4 clones), then **executes them on the same inputs to prove
they disagree**.

The one architectural rule everything else serves: **the LLM never sees the
codebase — it sees one function, or one candidate cluster, at a time.** Context
per call is tiny and constant; only the *number* of calls grows, and that is
handled by a cheap model + concurrency + content-hash caching.

## Commands

```bash
# 1. Index a repo → backend/.cache/<owner>-<repo>.json  (local, no LLM, no cost)
npm run index -- cline/cline --scope sdk/packages/core
npm run index -- actualbudget/actual --branch master --scope packages/loot-core/src
npm run index -- Kuzma02/Electronics-eCommerce-Shop-With-Admin-Dashboard-NextJS-NodeJS

#    --scope <path>   limit to a subfolder
#    --branch <name>  branch/tag (default: repo default)
#    --grep <text>    after indexing, print matching functions (verification)
#    --max <n>        cap functions — NOT set by default; a cap can hide a
#                     cluster member, so every drop is named in the log

# 2. Run the pipeline over the cache → writes clusters + stats to Mongo
npm run pipeline -- cline/cline

# 3. Serve the results (read-only; the demo reads Mongo, so it costs ₹0)
npm run dev
```

### API

```
GET  /api/v1/repos               -> RepoSummary[]
GET  /api/v1/repos/:repoId       -> { repo, stats, clusters }
GET  /api/v1/clusters/:clusterId -> ClusterDetail (members + divergence table)
POST /api/v1/guard/check         -> GuardResult   (the PR check)
```

## The stages

```
indexer (ts-morph, 0 tokens)        every function, exported or not, + purity
   ↓
fingerprint (cheap model, 1 fn/call) observable behaviour, name-blind, cached by bodyHash
   ↓
embed (the fingerprint ONLY)         never the name, never the code — the whole thesis
   ↓
cluster (in-memory cosine, 0 tokens) O(n²) dies here; the flagship never sees the cross-product
   ↓
adjudicate (flagship, 1 cluster/call) equivalence + adversarial probe inputs; may REJECT
   ↓
probe (worker_threads + vm, 0 tokens) executes PURE members only; executed ground truth
```

## Two rules that, if broken, break the product

1. **No names in the embedded text.** `buildEmbedText` takes a `Fingerprint` and
   nothing else — there is no parameter a name could enter through. Asserted in
   `tests/embedding.service.test.ts`.
2. **Execute pure functions only, and set `executed` truthfully.** The prober
   runs in a `vm` context with no `process`/`require`/`fetch`/`fs`, a 1s per-call
   timeout, and refuses to run anything the extractor did not prove pure. A
   function it cannot materialise is *excluded*, never recorded as a throw — a
   tooling failure must not masquerade as a behavioural difference.

### Purity (the rule the demo depends on)

Bar external **mutation** and **I/O**; **allow reads**. A function is pure if it
mutates nothing outside itself, does no I/O, is deterministic, uses no imported
identifier, and no `this`/`await` — but it *may* read module-level state and call
same-file pure helpers. `actualbudget`'s `currencyToAmount` is pure precisely
because of the "allow reads" half; a stricter rule would drop it and its cluster
would never surface.

To run such a function standalone, the indexer ships a `preamble`: the same-file
declarations it needs, gathered transitively. If a dependency reaches an import,
no preamble is emitted and the prober declines to make a claim.

Real repo functions are TypeScript; the `vm` runs JS. The prober strips types
with `ts.transpileModule` before executing. `body` stays verbatim for display.

## Verify

```bash
npm run typecheck && npm run lint && npm test    # 120 tests, all mocked/offline
npx tsx src/Scripts/verify-pipeline.ts           # full pipeline vs fixture, LLM mocked, Mongo + execution real
```

## Definition of Done — status

- [x] `typecheck`, `lint`, `test` pass clean (120 tests)
- [x] Every LLM output Zod-validated via strict Structured Outputs; no free-text JSON parsing
- [x] Fingerprints + embeddings cached by `bodyHash` (re-run is free; unit-tested)
- [x] `probe` executes ONLY pure functions and sets `executed` truthfully
- [x] Embedded text contains no function names (asserted in a unit test)
- [x] Indexer finds every function incl. non-exported (4× `truncateText`, 3 file-private, all pure)
- [x] `--scope`/`--branch` flags; tarball fetch, no `git` shell-out
- [x] No silent function cap
- [x] Model ids verified against OpenAI docs (2026-07-17): `gpt-5.4-nano`, `gpt-5.6-terra`
- [x] Pipeline runs end-to-end against the fixture and writes to Mongo **with the LLM mocked**
- [ ] Same run against a hero repo **with a real OpenAI key** — needs `OPENAI_API_KEY`

## Config

`.env` (see `.sample.env`): `OPENAI_API_KEY` (required), `MONGO_URI` (required),
`OPENAI_MODEL_CHEAP`, `OPENAI_MODEL_FLAGSHIP`, `EMBEDDING_MODEL`, `GITHUB_TOKEN`
(optional, raises the indexer's GitHub rate limit). Only `Config/AppConfig.ts`
reads `process.env`.
