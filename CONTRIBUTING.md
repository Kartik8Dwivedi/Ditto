# Contributing to Ditto

Thanks for being here. Ditto is early and built to grow, and the most useful
contributions are often not code — they're telling us where the tool is *wrong*.

## The single most valuable thing you can do

**Report a false positive.** Ditto's whole promise is precision: when it says two
functions do the same thing, it should be right. If it flags a cluster that isn't a
real duplicate, that's the most useful bug report we can get. Use the
[**Report a false positive**](../../issues/new?template=false_positive.yml) issue
template — include the repo and the cluster, and it directly improves the heuristics.

Runner-up: **run it on your own codebase and tell us what it found — or what it
should have found and didn't.** Both are gold.

## Ways to contribute

- **Report a false positive** (above) — most valuable.
- **File a bug** with the [bug template](../../issues/new?template=bug_report.yml).
- **Propose a feature** with the [feature template](../../issues/new?template=feature_request.yml).
- **Write code** — see [Good first issues](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
  and the areas below.
- **Improve docs** — a clearer explanation, a better example repo, a fixed typo.

## Where the project wants help most

These map to the roadmap in the [README](README.md):

- **A new language adapter.** The AST layer is the only language-specific part —
  everything downstream (fingerprint → embed → cluster → adjudicate → probe) is
  language-agnostic. Swapping `ts-morph` for `tree-sitter` opens up Python, Go, Java.
  This is the highest-leverage contribution.
- **Ditto Guard / MCP** — surface the index to a coding agent so it can ask "does
  this already exist?" *before* writing the duplicate.
- **Incremental re-indexing** — fingerprints are already cached by body hash; the
  missing piece is a CI job that re-indexes only what a commit touched.
- **Precision work** — anything that reduces false positives.

## Development setup

Full instructions are in the README's **[Run it yourself](README.md#run-it-yourself)**
section. The short version:

```bash
# backend
cd backend && npm install
npm run typecheck      # must pass
npm test               # must pass (194 tests)

# frontend
cd frontend && npm install
npm run build
```

You can develop most of the UI with **zero backend and zero API key** by setting
`NEXT_PUBLIC_DITTO_SOURCE=mock` — it renders from typed fixtures.

## Ground rules for code

- **Tests are required.** New behaviour needs a test; bug fixes should come with a
  red-before/green-after test. The backend suite is `vitest` and runs in CI on every PR.
- **Keep it hermetic.** Tests must not depend on the network, a live database, or a
  real API key — mock external services and read fixtures from `backend/tests/fixtures/`.
- **Honesty is a feature, not a slogan.** Ditto only ever claims what it can back up:
  a divergence is "proven" only when pure functions were actually executed and
  disagreed; everything else is "suspected." Please don't blur that line in code or copy.
- **Match the surrounding style.** TypeScript, Zod for validation/structured outputs,
  small focused modules. Run `npm run lint` and `npm run format` before pushing.

## Pull request flow

1. Fork and branch (`feat/…`, `fix/…`, `docs/…`).
2. Make the change with tests; ensure `npm run typecheck`, `npm test`, and the
   frontend build all pass.
3. Open a PR against `main` and fill in the template. Link the issue it closes.
4. A maintainer will review — we aim to respond within 24 hours.

## Code of Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Be kind;
assume good faith.

Not sure whether an idea fits? **Open an issue and ask** — we'd genuinely rather have
the conversation than have you hold back.
