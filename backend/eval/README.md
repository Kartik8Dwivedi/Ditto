# Ditto threshold calibration

Turns Ditto's two asserted similarity cut-offs into **measured** precision / recall / F1,
so "why 0.75?" and "what's your false-positive rate?" have numbers behind them instead of
assertions.

- **Cluster threshold `0.75`** — `SIMILARITY_THRESHOLD` in `src/Services/cluster.service.ts`.
  The average-linkage merge cut-off for proposing *candidate* clusters.
- **Guard floor `0.80`** — `GUARD_SEARCH_FLOOR` in `src/Services/guard.service.ts`.
  The cost gate below which a PR function is called `novel` without paying the flagship.

## How to run

```bash
cd backend
npx tsx eval/sweep.ts
```

Fully offline and **zero-cost**: it reads `labeled-pairs.json` (stored embeddings inlined)
and reuses the product's own `cosineSimilarity` from `cluster.service.ts`. It opens **no**
database connection and makes **no** API calls.

## Data source

- **MongoDB** (`cluster0.20s9wq5`, the analyzed corpus), read-only. Every one of the 6 912
  indexed functions already had a stored `text-embedding-3-small` 1536-dim embedding and a
  flagship-adjudicated fingerprint. **No embeddings were recomputed and no LLM was called** —
  we reused vectors already bought by the pipeline. (The `.cache/*.json` extracts hold raw
  function bodies only, no embeddings, so Mongo was the required source.)
- Embeddings in the fixture are rounded to 6 significant figures (cosine delta far below the
  0.01 sweep step).

## Dataset

`labeled-pairs.json` — 110 labeled pairs over 193 distinct functions:

| bucket | count | how chosen |
|---|---:|---|
| **positives** (clone) | 55 | Both functions in the **same Ditto cluster** (`sameBehavior=true`, flagship-adjudicated). One deterministic member pair per cluster, capped at 12/repo across 5 repos. |
| **hard negatives** (not-clone) | 30 | Compatible pairs (pass `isCompatible`), **never co-clustered**, in **different behavioural domains**, ranked by **highest cosine** — surface-similar, genuinely different. Cosine range 0.77–0.89. |
| **easy negatives** (not-clone) | 25 | Unrelated code across different repos **and** different domains. |

Each pair stores both function identifiers (repo, name, file, bodyHash), the fingerprint
`intent`/`domain`/`inputs`/`outputs`, the label, and a one-line rationale, so every row is
human-auditable.

## Results — measured on the 110 pairs

Cosine distribution by class:

- **positives:** min 0.771, median 0.889, mean 0.895, max 1.000
- **negatives:** min 0.171, median 0.731, mean 0.563, max 0.890

Predict `clone` when `cosine(a, b) >= threshold`. Sweep (abridged; full 0.60–0.95 table is
printed by `sweep.ts`):

| threshold | TP | FP | FN | TN | precision | recall | F1 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.70 | 55 | 30 | 0 | 25 | 0.647 | 1.000 | 0.786 |
| 0.73 | 55 | 28 | 0 | 27 | 0.663 | 1.000 | 0.797 |
| 0.74 | 55 | 23 | 0 | 32 | 0.705 | 1.000 | 0.827 |
| **0.75 (cluster)** | 55 | 21 | 0 | 34 | **0.724** | **1.000** | 0.840 |
| 0.76 | 55 | 18 | 0 | 37 | 0.753 | 1.000 | 0.859 |
| 0.78 | 54 | 11 | 1 | 44 | 0.831 | 0.982 | 0.900 |
| **0.79 (F1-optimal)** | 53 | 9 | 2 | 46 | **0.855** | **0.964** | **0.906** |
| **0.80 (guard)** | 52 | 9 | 3 | 46 | **0.852** | **0.945** | 0.897 |
| 0.82 | 47 | 8 | 8 | 47 | 0.855 | 0.855 | 0.855 |
| 0.85 | 39 | 6 | 16 | 49 | 0.867 | 0.709 | 0.780 |
| 0.89 | 26 | 0 | 29 | 55 | 1.000 | 0.473 | 0.642 |
| 0.95 | 13 | 0 | 42 | 55 | 1.000 | 0.236 | 0.382 |

### Operating points

| point | threshold | precision | recall | F1 | FP | FN |
|---|---:|---:|---:|---:|---:|---:|
| cluster | 0.75 | 0.724 | 1.000 | 0.840 | 21 | 0 |
| guard | 0.80 | 0.852 | 0.945 | 0.897 | 9 | 3 |
| **F1-optimal** | **0.79** | 0.855 | 0.964 | **0.906** | 9 | 2 |

## What the numbers say

- **The guard floor 0.80 is well-chosen.** Its F1 (0.897) sits within 0.01 of the F1-optimal
  threshold (0.79, F1 0.906) on this set — the difference is one pair. As a standalone
  cost gate it is essentially calibrated: precision 0.85, recall 0.95. **0.79 is marginally
  better on F1**, so if we wanted to squeeze recall we would nudge the floor down one step;
  the gain is inside the noise of a 110-pair set, so 0.80 stands.

- **The cluster threshold 0.75 is deliberately NOT F1-optimal, and that is correct.** At 0.75
  recall is 1.000 (it never drops a real clone here) but precision is only 0.724 — 21 of 55
  negatives cross it, almost all of them the hard, surface-similar ones. That is the design:
  clustering only *proposes* candidates, and the flagship adjudicator is the precision gate
  that rejects roughly half of what it sees. A recall-first candidate stage backed by a
  precision gate *should* look like this. If Ditto had **no** adjudicator and had to answer
  from cosine alone, the right threshold would be ~0.79, not 0.75 — the sweep says so plainly.
  The two-stage design is what buys 0.75 its legitimacy.

- **False positives are concentrated in the hard negatives.** Vectors alone cannot separate
  a Type-4 clone from a same-shaped, different-behaviour lookalike; that separation is exactly
  what the flagship stage exists to do. The FP counts above are a stress figure, not a natural
  base rate (see limitations).

## Limitations — read this as calibration, not a gold standard

- **Small and single-corpus.** 110 pairs from one 9-repo corpus. Confidence intervals are wide;
  a one-pair move shifts F1 by ~0.01.
- **Labels are derived from Ditto's own clustering.** Positives *are* "pairs Ditto grouped",
  so they were selected partly *because* their cosine is high — by construction no positive
  pair sits below ~0.70. That makes recall at low thresholds partly **circular**: the honest
  signal lives in precision and in how the hard negatives behave, not in recall below ~0.78.
  This is **calibration of an internally-consistent pipeline, not validation against an
  independent human-labeled gold set.**
- **Negatives are deliberately adversarial.** 30 of 55 are hard negatives chosen for *maximum*
  cosine, so the measured false-positive rate overstates what a random PR would see. It is a
  worst-case stress test, on purpose.
- An independent, human-labeled clone benchmark (e.g. hand-audited cross-repo pairs) would be
  needed to turn these calibration numbers into an unbiased precision/recall claim.
