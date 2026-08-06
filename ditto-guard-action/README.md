# Ditto Guard — GitHub Action

Run Ditto's per-PR semantic-clone check in CI. On every pull request, Ditto Guard asks a
question your linter and tests can't: **"did this PR just reinvent logic that already
exists in the repo?"** — and when the reinvented function is pure, it **runs both versions
in a sandbox and proves whether they disagree.**

It's read-only and needs no access to your codebase beyond the PR: the analysis runs
server-side against a Ditto API instance.

## Usage

```yaml
# .github/workflows/ditto.yml
name: Ditto Guard
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write   # only needed if `comment: true`

jobs:
  ditto:
    runs-on: ubuntu-latest
    steps:
      - uses: kartik8dwivedi/ditto-guard-action@v1
        with:
          fail-on: none   # advisory by default
```

That's it — no checkout required. Ditto Guard reads the PR from the event context, submits
it to the API, waits for the result, and posts a comment when it finds reinvented logic.

## Inputs

| Input | Default | Description |
|---|---|---|
| `api-url` | the hosted Ditto API | Base URL of the Ditto API instance to use. Point this at your own deployment if you self-host. |
| `github-token` | `${{ github.token }}` | Token used to post the PR comment. Needs `pull-requests: write`. |
| `fail-on` | `none` | `none` (advisory) · `duplicate` (fail if any reinvented function is found) · `proven-divergence` (fail only when execution proves a disagreement). |
| `timeout-seconds` | `300` | Max wait. The **first** PR on a repo Ditto has never seen indexes the whole repo once, which can be slow; later PRs are fast. |
| `comment` | `true` | Post a PR comment when reinvented functions are found. The job summary is always written. |

## What a finding looks like

> ## 🔁 Ditto Guard
> Found **1** function(s) that reinvent existing behaviour (**1** proven by execution):
> - 🔴 **PROVEN divergence** — `shortenText` (`src/utils/string.ts:42`) reinvents `truncateText` (`src/shared/formatting.ts:118`) — already used by 3 module(s)
>
> _Proven = both functions ran in a sandbox and disagreed._

🔴 **proven** means Ditto executed both functions and they returned different results.
🟡 **suspected** means the functions look equivalent but at least one is impure, so it was
not executed — Ditto never claims proof it doesn't have.

## How it works

The action is a thin client. The Ditto API does the work: fetch the PR diff → extract only
the changed functions (`ts-morph`) → search the repo's behavioural index → adjudicate
candidate matches with an LLM → execute pure matches in a `worker_threads` + `vm` sandbox to
produce an executed divergence table. See the main project's `DESIGN.md`.

## Requirements

- Runs on `pull_request` events.
- The runner needs `curl`, `jq`, and `gh` — all present on GitHub-hosted runners.
- For comments, grant `pull-requests: write`.

## Publishing to the GitHub Marketplace

This directory is self-contained so it can become its own repository:

1. Copy `action.yml`, `scripts/`, and this `README.md` to the root of a new public repo
   (e.g. `kartik8dwivedi/ditto-guard-action`).
2. Push a tagged release (`v1`) — the Marketplace publishes from a tag.
3. On the release page, check **"Publish this Action to the GitHub Marketplace"** and pick a
   category (Code quality / Code review).
4. Consumers then reference it as `kartik8dwivedi/ditto-guard-action@v1`.

<!-- TODO(Kartik): create the standalone repo + v1 release to list this on the Marketplace. -->
