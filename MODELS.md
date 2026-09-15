# Models

Ditto uses three models, each chosen for one job. Model IDs are **configuration, not
code** — they live in environment variables (`backend/src/Config/AppConfig.ts`), because
a "model not found" is an env change, not a code change. The values below are the
defaults; any deployment can override them.

| Env var | Default model | Role in the pipeline | Why this tier |
|---|---|---|---|
| `OPENAI_MODEL_CHEAP` | `gpt-5.4-nano` | **Fingerprinting** — reads one function and writes a name- and syntax-blind description of its behaviour (intent, domain, signature). | Runs once per function, so it must be cheap. It never sees the file, the repo, or other functions — context per call is tiny and constant, which is exactly what a nano model handles well. |
| `OPENAI_MODEL_FLAGSHIP` | `gpt-5.6-terra` | **Adjudication** — decides whether the functions in a candidate cluster are truly equivalent, and generates adversarial test inputs for the sandbox. | Runs **only** on the handful of pre-filtered candidate clusters (gated behind a 0.80 cosine floor), never on the O(n²) cross-product. Reserving the expensive model for this narrow, high-value step is what keeps total cost low. |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | **Embedding** — turns each behavioural fingerprint into a vector for cosine similarity + clustering. | We embed the *fingerprint* (behaviour), never the raw code or the function name — embedding code text pushes `normalizePhone` and `formatMobile` apart, the exact bias the product exists to escape. The small embedding model is sufficient and cheap at corpus scale. |

Embedding recipe version: `EMBED_VERSION = "v2-purpose-shape"`. Every stored vector is
stamped with the recipe it was built under, so cached vectors from an older recipe are
never silently compared against current ones.

## The cost split (why two model tiers)

The cheap model does the work that scales with repo size (one fingerprint per function).
The flagship does the work that scales with *findings*, not repo size (adjudicate only the
clusters that survived cheap vector filtering). The expensive call fires precisely when
there is something worth judging.

- **Measured, one-time, offline:** ~₹232 (~$2.80) to fully analyze **2,870 functions**
  (2,785 fingerprint calls + 100 adjudications) for `github/gh-aw`.
- **Serving a result:** ₹0 — reads MongoDB, no model call at request time.

> This is a single measured run at a specific repo size and model pricing, not a
> guaranteed unit price; it scales with function count and per-token cost.

## Per-token pricing (fill in from your provider's current catalog)

| Model | Input price | Output price |
|---|---|---|
| `gpt-5.4-nano` | $0.20 / 1M tokens | $1.25 / 1M tokens |
| `gpt-5.6-terra` | $2.50 / 1M tokens | $15 / 1M tokens |
| `text-embedding-3-small` | _pending_ | n/a |

All model calls use **Structured Outputs** with strict JSON schemas (Zod-validated) — the
model returns typed data, never free text that needs parsing.
