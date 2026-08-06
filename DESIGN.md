# Ditto — Design & Architecture Decisions

Ditto finds **Type-4 semantic clones** in JavaScript/TypeScript: functions that do
the *same thing* but are written *completely differently*. Token- and AST-based tools
(jscpd, SonarQube CPD) return literal zero on these, because a Type-4 clone is by
definition same-behaviour / different-syntax — any representation that encodes syntax
cannot see it.

What makes Ditto more than an LLM wrapper is where it *stops trusting the model*: after
the model proposes that two functions are equivalent, Ditto **executes them in a sandbox
on adversarial inputs and records what they actually return.** The evidence it ships is
executed ground truth, not a model opinion.

This document records the decisions that matter and the alternatives they beat.

---

## 1. The pipeline

```
ts-morph extract  →  LLM fingerprint  →  embed the fingerprint  →  cosine + average-linkage cluster
                                                                          ↓
                          executed divergence  ←  sandbox probe  ←  LLM adjudicate candidate clusters
```

Each function is processed **one at a time**; the model never sees the file, the repo,
or the other functions. Context per call is tiny and constant — it does not grow with
repo size. That single property is what makes the cost model work (§6).

### Decision: embed the behavioural *fingerprint*, never the code or the name
The embedded text is built from the fingerprint **and nothing else** — `intent | domain |
inputs -> outputs`. No function name, no file path, no raw source. This is the whole
thesis, not a style choice: `normalizePhone` and `formatMobile` do the same thing, but
embed their *names* and the vectors are pushed apart by the exact syntactic signal we
exist to escape. Embedding raw code fails identically.

We also deliberately **exclude the granular step-by-step behaviour** from the vector. Those
steps describe *how* a function works — which is exactly where two equivalent
implementations diverge. Embedding them pushes divergent-but-equivalent functions apart so
they never cluster: measured on the four cline `truncateText` implementations, including the
steps drove pairwise cosine as low as **0.66** and complete-linkage split them. We cluster
by *what a function is for*, then let the adjudicator and the prober find the differences.
(The recipe is stamped `EMBED_VERSION = "v2-purpose-shape"`; see §4.)

---

## 2. The execution sandbox (the differentiator)

Everything upstream of execution is an opinion. The probe runs the candidate functions on
the adjudicator's inputs and records what they actually returned. So the one thing that must
never happen is a **fabricated row** — a tooling failure masquerading as a behavioural
difference. The design follows from that.

### Decision: two isolation layers — a worker thread *outside*, a fresh `vm` context *inside*
- **`worker_threads` (outer):** a wedged run must be terminable from outside the failing
  code. The worker is held to a hard wall-clock bound (`MAX_WORKER_MS = 30s`) and terminated.
- **`vm.createContext(Object.create(null))` (inner):** the function runs in a context with
  JS intrinsics and **nothing else** — no `process`, no `require`, no `fetch`, no timers.
  This is not a deny-policy that could be misconfigured; it is an *absence*. There is no
  filesystem or network to reach from in there.

### Decision: make the call *inside* `runInContext`, and let only strings cross the realm
Node's `vm` timeout only governs code running inside `runInContext`. Pull the function out
and call it from the worker and you silently opt out of the timeout — a runaway loop then
runs forever. So the call itself happens inside the context (`globalThis.__call`), which
hands back a JSON string; nothing but strings ever crosses the realm boundary. Per-call
budget is **`PROBE_TIMEOUT_MS = 1s`** — a pure utility that needs a second is not a pure
utility. The outer worker bound exists for what the `vm` timeout *cannot* interrupt at all:
catastrophic regex backtracking runs in native code and ignores it.

### Decision: only *pure* functions execute; unmaterialisable ones are *excluded*, never faked
Purity is proven at extraction time and is the gate on execution. Impure functions have
database calls, network, and side effects — executing them is both meaningless and a
security hole. A function we cannot turn into a callable is **excluded from the table**, not
recorded as "threw." `executed: true` is set only after real code really ran. Each member
also gets **its own context**, so no shared mutable global state can make execution order
change a result.

### Decision: compare on the full serialisation, key errors by *type*
Outputs are canonically serialised (object keys sorted, so `{a,b}` and `{b,a}` agree) and the
comparison key is built from the **full** serialisation even when the display value is
truncated (long values hash to `sha256`) — so two different long outputs never collapse into
a false agreement. Thrown errors are keyed on the error **type**, not its wording: two
implementations that both reject bad input with a `TypeError` agree; throw-vs-return, and
`TypeError`-vs-`RangeError`, still diverge.

---

## 3. The incremental / per-PR path must not reuse the full pipeline

The full-repo `pipeline.run` is **destructive**: it `replaceForRepo`s — deletes every stored
function and cluster for the repo and recomputes whole-repo stats. That is correct for a full
re-index and catastrophic for an incremental check: calling it with a PR's handful of changed
functions would wipe the repo's paid index.

### Decision: the PR path composes services directly and writes a self-contained result
Per-PR analysis (`pr.service`) never calls `pipeline.run`. It fingerprints + embeds only the
changed functions, searches the cached index, builds a candidate cluster of `[PR fn + matched
impl]`, adjudicates, and probes — then stores a **self-contained `PrAnalysis`** with the
findings and divergence embedded inline. It does not insert the PR's functions into the repo's
function collection, so there is no index pollution and no dangling references. The only
correct use of the destructive `pipeline.run` on this path is the *one-time base-repo index*
when a repo has never been seen (`live-index`), which is a full index by definition.

---

## 4. The embedding-cache invalidation contract

Embeddings (and fingerprints) are cached **content-addressed by `bodyHash`** — the sha256 of
the whitespace-normalised function body — and the cache is deliberately **unscoped across
repositories**: a body fingerprinted and embedded anywhere is free everywhere. This is what
makes re-analysis and per-PR checks near-free.

The hazard: `bodyHash` does not change when the *embed-text recipe* changes. A recipe change
would silently compare vectors built under different recipes and return a meaningless cosine.

### Decision: stamp every vector with `EMBED_VERSION`; reuse only on an exact match, else recompute or fail loud
Each stored embedding records the `EMBED_VERSION` it was built under. A cached vector is reused
only when its version matches the current recipe; otherwise the (cheap, few) incoming functions
are recomputed. If a repo's *stored index* is found to be a stale recipe, the guard/PR path
**fails loud** rather than silently cosine-comparing incompatible vectors — a whole-repo
re-index is the pipeline's job, not something to paper over on the read path.

---

## 5. The honesty model: proven vs suspected

The distinction is enforced in code, not just in copy:
- A finding is **`proven`** only when both functions are pure, the sandbox actually ran them,
  and they disagreed. Only this may be rendered as a hard conflict (red).
- Everything else is **`suspected`** — the model believes the functions are equivalent, but no
  execution backed it. Never rendered as proof (amber).
- Functions that cannot be materialised are excluded, not counted as divergences.

This is a deliberate epistemic boundary. Across the evaluation corpus, **18 of 174 clusters are
execution-proven**; the rest are suspected. Reporting the smaller, harder number is the point —
it is what makes every number in the project survive being checked.

---

## 6. Cost architecture

The naïve approach — ask an LLM about every pair of functions — is O(n²) model calls and is
economically impossible at repo scale. Ditto avoids it:

- **The O(n²) step is free math.** Similarity is in-memory cosine over the fingerprint vectors,
  and grouping is average-linkage clustering — no vector database, no per-pair model call.
- **The flagship model is gated.** It runs *only* on the handful of candidate clusters that
  survive the cosine floor — never on the cross-product.
- **Two model tiers.** A cheap nano model fingerprints *every* function (the part that scales
  with repo size); the flagship adjudicates *only* candidate clusters (bounded by the candidate
  cap). Embeddings use a small embedding model. (See `MODELS.md`.)
- **$0 to serve.** A served result reads MongoDB; no model runs at request time.
- **Content-addressed caching** makes re-checks and incremental PR checks near-free.

Measured, one-time, offline: **~₹232 (~$2.80)** to fully analyse **2,870 functions**
(2,785 fingerprints + 100 adjudications) for `github/gh-aw`. This is a single measured run at a
specific repo size and model price, not a guaranteed unit rate — it scales with function count
and per-token cost.

---

## 7. Similarity thresholds, justified by measurement

The two thresholds are not magic numbers; they are a deliberate two-stage design, and the
`backend/eval/` harness measures them on a labelled set.

| Stage | Threshold | Precision | Recall | F1 | Role |
|---|---|---|---|---|---|
| Cluster (candidate) | **0.75** | 0.724 | **1.000** | 0.840 | recall-first — catch every candidate |
| Guard (PR search floor) | **0.80** | 0.852 | 0.945 | 0.897 | balanced pre-filter for the flagship |
| (F1-optimal, reference) | 0.79 | 0.855 | 0.964 | 0.906 | — |

The cluster stage is **deliberately recall-first**: at 0.75 it catches essentially every real
candidate (recall ≈ 1.0) at the cost of precision (0.72), because the **LLM adjudicator is the
precision gate downstream** — a false candidate is cheap to reject, a missed one is gone
forever. The guard floor at 0.80 sits within ~0.01 F1 of the measured optimum, so it stands.

**Honest limitation:** the labels derive from Ditto's own clustering, so this is *calibration*,
not an independent gold set; the negatives are deliberately adversarial (surface-similar,
different behaviour), making the false-positive figure a worst-case stress number. See
`backend/eval/README.md`.

---

## 8. Ingestion & extraction (supporting decisions)

- **No `git clone`, no disk.** Repos are pulled as GitHub tarballs and gunzipped in memory,
  with an `api.github.com` → `codeload.github.com` fallback (the fallback has no API rate limit).
- **`ts-morph` AST extraction** captures every function — declarations, methods, arrow consts,
  object methods, accessors — with purity analysis and a same-file **preamble** (the helpers and
  constants a pure function needs) so it can be reconstituted and executed in the sandbox.
- **Structured Outputs + Zod** on every model call: the model returns typed, schema-validated
  data, never free text that needs parsing.
