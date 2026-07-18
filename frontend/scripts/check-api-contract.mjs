/**
 * Contract check — does the live backend match types/ditto.ts (PRD §2)?
 *
 *   node scripts/check-api-contract.mjs <repoId> <clusterId>
 *   API=http://localhost:3001 node scripts/check-api-contract.mjs <repoId> <clusterId>
 *
 * Hits GET /repos, /repos/:id, /clusters/:id, and validates every field of the
 * real responses against the pinned shapes. Reports any mismatch — a missing
 * field, a wrong type, an out-of-range value, a divergence row whose `diverged`
 * flag contradicts its outputs. Run it the moment the backend is serving; if it
 * is clean, the frontend will render the real data unchanged.
 *
 * Pure Node, no deps. Exit code is non-zero if the contract is violated.
 */
const API = (process.env.API ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(
  /\/$/,
  '',
);
const [, , repoIdArg, clusterIdArg] = process.argv;

const problems = [];
const note = (path, msg) => problems.push(`${path}: ${msg}`);

const RISKS = ['none', 'cosmetic', 'semantic'];

function isStr(v) {
  return typeof v === 'string';
}
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
function isBool(v) {
  return typeof v === 'boolean';
}

function checkField(obj, path, key, pred, predName) {
  if (!(key in obj)) {
    note(`${path}.${key}`, `missing (expected ${predName})`);
    return false;
  }
  if (!pred(obj[key])) {
    note(`${path}.${key}`, `expected ${predName}, got ${JSON.stringify(obj[key])}`);
    return false;
  }
  return true;
}

function checkRepoSummary(r, path) {
  if (typeof r !== 'object' || r === null) return note(path, 'not an object');
  checkField(r, path, 'id', isStr, 'string');
  checkField(r, path, 'owner', isStr, 'string');
  checkField(r, path, 'name', isStr, 'string');
  checkField(r, path, 'commit', isStr, 'string');
  checkField(r, path, 'indexedAt', isStr, 'string');
  if (isStr(r.indexedAt) && Number.isNaN(new Date(r.indexedAt).getTime())) {
    note(`${path}.indexedAt`, `not a parseable date: ${r.indexedAt}`);
  }
}

const STAT_KEYS = [
  'functions', 'files', 'modules', 'semanticDuplicateClusters', 'behavioralConflicts',
  'nearDuplicates', 'reusableUtilities', 'suspectedReinvented', 'linesRemovable',
  'callSitesUnifiable', 'healthScore', 'functionsTotal', 'functionsAnalyzed',
];

function checkStats(s, path) {
  if (typeof s !== 'object' || s === null) return note(path, 'not an object');
  for (const k of STAT_KEYS) checkField(s, path, k, isNum, 'number');
  if (isNum(s.healthScore) && (s.healthScore < 0 || s.healthScore > 100)) {
    note(`${path}.healthScore`, `out of range 0-100: ${s.healthScore}`);
  }
  if (isNum(s.functionsAnalyzed) && isNum(s.functionsTotal) && s.functionsAnalyzed > s.functionsTotal) {
    note(`${path}`, `functionsAnalyzed ${s.functionsAnalyzed} exceeds functionsTotal ${s.functionsTotal}`);
  }
}

function checkClusterSummary(c, path) {
  if (typeof c !== 'object' || c === null) return note(path, 'not an object');
  checkField(c, path, 'id', isStr, 'string');
  checkField(c, path, 'domain', isStr, 'string');
  checkField(c, path, 'behaviorSummary', isStr, 'string');
  checkField(c, path, 'memberCount', isNum, 'number');
  checkField(c, path, 'confidence', isNum, 'number');
  if (isNum(c.confidence) && (c.confidence < 0 || c.confidence > 1)) {
    note(`${path}.confidence`, `out of range 0-1: ${c.confidence}`);
  }
  if (!RISKS.includes(c.disagreementRisk)) {
    note(`${path}.disagreementRisk`, `expected one of ${RISKS.join('|')}, got ${JSON.stringify(c.disagreementRisk)}`);
  }
  checkField(c, path, 'hasProvenDivergence', isBool, 'boolean');
  checkField(c, path, 'linesRemovable', isNum, 'number');
}

function checkClusterDetail(c, path) {
  checkClusterSummary(c, path);
  if (!Array.isArray(c.members)) {
    note(`${path}.members`, 'expected array');
  } else {
    if (isNum(c.memberCount) && c.memberCount !== c.members.length) {
      note(`${path}.memberCount`, `says ${c.memberCount} but members.length is ${c.members.length}`);
    }
    const ids = new Set();
    let canonical = 0;
    c.members.forEach((m, i) => {
      const mp = `${path}.members[${i}]`;
      checkField(m, mp, 'id', isStr, 'string');
      checkField(m, mp, 'name', isStr, 'string');
      checkField(m, mp, 'file', isStr, 'string');
      checkField(m, mp, 'startLine', isNum, 'number');
      checkField(m, mp, 'endLine', isNum, 'number');
      checkField(m, mp, 'body', isStr, 'string');
      checkField(m, mp, 'loc', isNum, 'number');
      checkField(m, mp, 'isPure', isBool, 'boolean');
      checkField(m, mp, 'isCanonical', isBool, 'boolean');
      if (isStr(m.id)) ids.add(m.id);
      if (m.isCanonical === true) canonical++;
    });
    if (canonical !== 1) note(`${path}.members`, `expected exactly 1 canonical, found ${canonical}`);

    if (!Array.isArray(c.differences)) note(`${path}.differences`, 'expected array');

    if (c.divergence !== undefined) {
      const dp = `${path}.divergence`;
      checkField(c.divergence, dp, 'executed', isBool, 'boolean');
      if (!Array.isArray(c.divergence.rows)) {
        note(`${dp}.rows`, 'expected array');
      } else {
        c.divergence.rows.forEach((row, ri) => {
          const rp = `${dp}.rows[${ri}]`;
          checkField(row, rp, 'input', isStr, 'string');
          checkField(row, rp, 'diverged', isBool, 'boolean');
          if (!Array.isArray(row.results)) {
            note(`${rp}.results`, 'expected array');
            return;
          }
          const keys = new Set();
          row.results.forEach((res, i) => {
            const rrp = `${rp}.results[${i}]`;
            checkField(res, rrp, 'functionId', isStr, 'string');
            checkField(res, rrp, 'output', isStr, 'string');
            if ('error' in res && res.error !== undefined && !isStr(res.error)) {
              note(`${rrp}.error`, `expected string, got ${JSON.stringify(res.error)}`);
            }
            if (isStr(res.functionId) && ids.size && !ids.has(res.functionId)) {
              note(`${rrp}.functionId`, `does not match any member id: ${res.functionId}`);
            }
            keys.add(res.error ? `threw:${res.error}` : res.output);
          });
          const reallyDiverged = keys.size > 1;
          if (isBool(row.diverged) && row.diverged !== reallyDiverged) {
            note(`${rp}.diverged`, `is ${row.diverged} but the ${keys.size} distinct output(s) say ${reallyDiverged}`);
          }
        });
      }
    } else if (c.hasProvenDivergence === true) {
      note(`${path}`, 'hasProvenDivergence is true but there is no divergence object');
    }
  }
}

async function get(path) {
  const url = `${API}/api/v1${path}`;
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    note(url, `could not connect: ${e.message}`);
    return null;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    note(url, `HTTP ${res.status} — response was not JSON`);
    return null;
  }
  if (typeof body !== 'object' || body === null || typeof body.success !== 'boolean' || !('data' in body)) {
    note(url, 'response is not the { success, message, data } envelope');
    return null;
  }
  if (!body.success) {
    note(url, `envelope.success is false: ${body.message}`);
    return null;
  }
  return body.data;
}

async function main() {
  console.log(`\nChecking ${API} against types/ditto.ts …\n`);

  const repos = await get('/repos');
  if (repos !== null) {
    if (!Array.isArray(repos)) note('/repos data', 'expected RepoSummary[]');
    else {
      repos.forEach((r, i) => checkRepoSummary(r, `/repos[${i}]`));
      console.log(`  /repos                 → ${repos.length} repo(s)`);
    }
  }

  const repoId = repoIdArg ?? (Array.isArray(repos) && repos[0] ? repos[0].id : undefined);
  if (repoId) {
    const detail = await get(`/repos/${encodeURIComponent(repoId)}`);
    if (detail !== null) {
      checkRepoSummary(detail.repo ?? {}, '/repos/:id .repo');
      checkStats(detail.stats ?? {}, '/repos/:id .stats');
      if (!Array.isArray(detail.clusters)) note('/repos/:id .clusters', 'expected array');
      else {
        detail.clusters.forEach((c, i) => checkClusterSummary(c, `/repos/:id .clusters[${i}]`));
        // behavioralConflicts is the SUSPECTED count and must be a superset of
        // what was actually executed and proven. Fewer suspected than proven
        // would mean the UI could claim proof the cluster list cannot show.
        const proven = detail.clusters.filter((c) => c.hasProvenDivergence).length;
        if (isNum(detail.stats?.behavioralConflicts) && detail.stats.behavioralConflicts < proven) {
          note(
            '/repos/:id .stats.behavioralConflicts',
            `${detail.stats.behavioralConflicts} suspected but ${proven} clusters are proven — suspected can never be fewer than proven`,
          );
        }
        console.log(
          `  ↳ conflicts: ${detail.stats?.behavioralConflicts} suspected · ${proven} proven by execution`,
        );
      }
      console.log(`  /repos/${repoId}  → ${detail.clusters?.length ?? 0} cluster(s)`);
    }
  } else {
    console.log('  (no repoId given and none discoverable — pass one as arg 1 to check /repos/:id)');
  }

  const clusterId = clusterIdArg;
  if (clusterId) {
    const detail = await get(`/clusters/${encodeURIComponent(clusterId)}`);
    if (detail !== null) {
      checkClusterDetail(detail, `/clusters/${clusterId}`);
      console.log(`  /clusters/${clusterId}  → ${detail.members?.length ?? 0} member(s), divergence ${detail.divergence ? (detail.divergence.executed ? 'executed' : 'predicted') : 'none'}`);
    }
  } else {
    console.log('  (no clusterId given — pass one as arg 2 to check /clusters/:id)');
  }

  console.log('');
  if (problems.length === 0) {
    console.log('✓ contract OK — the API matches types/ditto.ts\n');
  } else {
    console.log(`✗ ${problems.length} contract mismatch(es):\n`);
    for (const p of problems) console.log(`  · ${p}`);
    console.log('');
    process.exitCode = 1;
  }
}

main();
