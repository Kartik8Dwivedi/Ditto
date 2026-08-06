#!/usr/bin/env bash
#
# Ditto Guard — CI entry point.
#
# The heavy lifting is server-side: the Ditto API fetches the PR, extracts the
# changed functions, searches the repo index, and runs the sandbox probe. This
# script only submits the PR, waits for the result, and reports it.
#
# Depends on: bash, curl, jq, gh (all present on GitHub-hosted runners).

set -euo pipefail

API_URL="${INPUT_API_URL:-https://ditto-backend-1016629498190.asia-south2.run.app}"
API_URL="${API_URL%/}"
FAIL_ON="${INPUT_FAIL_ON:-none}"
TIMEOUT="${INPUT_TIMEOUT_SECONDS:-300}"
COMMENT="${INPUT_COMMENT:-true}"

# --- advisory-exit helper: by default a Ditto/infra problem never breaks the build ---
soft_exit() { # $1 = message
  echo "::warning::$1"
  [[ "$FAIL_ON" == "none" ]] && exit 0 || { echo "::error::$1"; exit 1; }
}

# --- resolve the PR from the event payload ---
event="${GITHUB_EVENT_PATH:-}"
if [[ -z "$event" || ! -f "$event" ]]; then
  echo "::error::No event payload found. Ditto Guard must run on a 'pull_request' event."
  exit 1
fi
owner="$(jq -r '.repository.owner.login' "$event")"
name="$(jq -r '.repository.name' "$event")"
pr_number="$(jq -r '.pull_request.number // .number // empty' "$event")"
if [[ -z "$pr_number" || "$owner" == "null" || "$name" == "null" ]]; then
  echo "::error::Could not determine owner/name/PR-number from the event payload."
  exit 1
fi
echo "Ditto Guard: analysing ${owner}/${name} PR #${pr_number} via ${API_URL}"

api() { # $1 method  $2 path  [$3 json body]
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS --fail-with-body -X "$method" "${API_URL}${path}" \
      -H 'Content-Type: application/json' -d "$body"
  else
    curl -sS --fail-with-body -X "$method" "${API_URL}${path}"
  fi
}

# --- submit the PR ---
body="$(jq -nc --arg o "$owner" --arg n "$name" --argjson p "$pr_number" \
  '{owner:$o, name:$n, prNumber:$p}')"
submit="$(api POST /api/v1/pr "$body")" || soft_exit "Ditto API request failed (network or 4xx/5xx)."

if [[ "$(jq -r '.success // false' <<<"$submit")" != "true" ]]; then
  soft_exit "Ditto API returned an error: $(jq -r '.message // "unknown"' <<<"$submit")"
fi

pr_analysis_id="$(jq -r '.data.prAnalysisId // empty' <<<"$submit")"
job_id="$(jq -r '.data.jobId // empty' <<<"$submit")"

# --- poll the job if the result was not returned synchronously ---
if [[ -z "$pr_analysis_id" && -n "$job_id" ]]; then
  echo "Queued as job ${job_id}; polling up to ${TIMEOUT}s…"
  deadline=$(( $(date +%s) + TIMEOUT ))
  while :; do
    job="$(api GET "/api/v1/jobs/${job_id}")" || soft_exit "Failed to poll job ${job_id}."
    status="$(jq -r '.data.status // empty' <<<"$job")"
    echo "  status=${status} stage=$(jq -r '.data.stage // "?"' <<<"$job")"
    case "$status" in
      done)   pr_analysis_id="$(jq -r '.data.prAnalysisId // empty' <<<"$job")"; break ;;
      failed) soft_exit "Ditto analysis failed: $(jq -r '.data.error // "unknown"' <<<"$job")" ;;
    esac
    (( $(date +%s) >= deadline )) && soft_exit "Ditto analysis timed out after ${TIMEOUT}s."
    sleep 5
  done
fi

[[ -z "$pr_analysis_id" ]] && soft_exit "No PR analysis id was returned."

# --- fetch the finished analysis ---
analysis="$(api GET "/api/v1/pr/${pr_analysis_id}")" || soft_exit "Failed to fetch PR analysis ${pr_analysis_id}."
findings="$(jq -c '.data.findings // []' <<<"$analysis")"
changed="$(jq -r '.data.changedFunctions // 0' <<<"$analysis")"
dupe_count="$(jq '[.[] | select(.verdict=="duplicate" or .verdict=="near-duplicate")] | length' <<<"$findings")"
proven_count="$(jq '[.[] | select(.proof=="executed")] | length' <<<"$findings")"

# --- build the report ---
report="$(mktemp)"
{
  echo "## 🔁 Ditto Guard"
  echo ""
  if [[ "$dupe_count" -eq 0 ]]; then
    echo "✅ No reinvented logic found in this PR's changed functions."
  else
    echo "Found **${dupe_count}** function(s) that reinvent existing behaviour (**${proven_count}** proven by execution):"
    echo ""
    jq -r '
      .[] | select(.verdict=="duplicate" or .verdict=="near-duplicate") |
      "- " +
      (if .proof=="executed" then "🔴 **PROVEN divergence** — " else "🟡 suspected — " end) +
      "`" + .newFunction.name + "` (`" + .newFunction.file + ":" + (.newFunction.startLine|tostring) + "`) " +
      "reinvents `" + (.match.name // "?") + "` (`" + (.match.file // "?") + ":" + ((.match.startLine // 0)|tostring) + "`)" +
      (if (.usedBy|length) > 0 then " — already used by " + ((.usedBy|length)|tostring) + " module(s)" else "" end)
    ' <<<"$findings"
  fi
  echo ""
  echo "_Analysed ${changed} changed function(s). Proven = both functions ran in a sandbox and disagreed._"
} > "$report"

# --- surface it: job summary always, PR comment when there is something to say ---
cat "$report" >> "${GITHUB_STEP_SUMMARY:-/dev/null}" || true
if [[ "$COMMENT" == "true" && "$dupe_count" -gt 0 ]]; then
  GH_TOKEN="${INPUT_GITHUB_TOKEN}" gh pr comment "$pr_number" --repo "${owner}/${name}" --body-file "$report" \
    || echo "::warning::Could not post PR comment — ensure the workflow grants 'pull-requests: write'."
fi

# --- optional gate ---
case "$FAIL_ON" in
  proven-divergence) (( proven_count > 0 )) && { echo "::error::${proven_count} proven divergence(s) found."; exit 1; } ;;
  duplicate)         (( dupe_count   > 0 )) && { echo "::error::${dupe_count} reinvented function(s) found."; exit 1; } ;;
esac
exit 0
