/**
 * Fixture audit — see audit.md.
 *
 * The fixtures make claims a judge can check. This checks them first.
 *
 *   cd frontend && node lib/mocks/audit.mjs
 *
 * It compiles the fixtures with the project's own tsconfig paths and asserts
 * the invariants that, if broken, would put a visible lie on screen — chiefly:
 * a row marked `diverged` whose cells are all identical.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const out = mkdtempSync(join(tmpdir(), 'ditto-audit-'));

function compile() {
  const config = {
    compilerOptions: {
      target: 'es2022',
      module: 'commonjs',
      moduleResolution: 'node',
      outDir: out,
      rootDir: ROOT,
      baseUrl: ROOT,
      paths: { '@/*': ['./*'] },
      skipLibCheck: true,
      strict: true,
      esModuleInterop: true,
    },
    include: [`${ROOT}/lib/mocks/**/*.ts`, `${ROOT}/types/**/*.ts`],
  };
  const configPath = join(out, 'tsconfig.audit.json');
  writeFileSync(configPath, JSON.stringify(config));
  execFileSync('npx', ['tsc', '--project', configPath], { cwd: ROOT, stdio: 'pipe' });
  return join(out, 'lib', 'mocks', 'index.js');
}

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

/** A throw is a result too. */
const key = (r) => (r.error ? `threw:${r.error}` : r.output);

function auditCluster(repoId, cluster) {
  const at = `${repoId} / ${cluster.domain}`;

  if (cluster.memberCount !== cluster.members.length) {
    fail(at, `memberCount ${cluster.memberCount} but members.length ${cluster.members.length}`);
  }

  const canonical = cluster.members.filter((m) => m.isCanonical);
  if (canonical.length !== 1) {
    fail(at, `expected exactly 1 canonical member, found ${canonical.length}`);
  }

  if (!cluster.differences || cluster.differences.length === 0) {
    fail(at, 'differences is empty');
  }

  if (cluster.confidence < 0 || cluster.confidence > 1) {
    fail(at, `confidence ${cluster.confidence} out of range`);
  }

  const ids = new Set();
  for (const m of cluster.members) {
    if (ids.has(m.id)) fail(at, `duplicate member id ${m.id}`);
    ids.add(m.id);

    const lines = m.body.split('\n').length;
    if (m.loc !== lines) fail(at, `${m.name}: loc ${m.loc} but body has ${lines} lines`);

    const span = m.endLine - m.startLine + 1;
    if (span !== m.loc) {
      fail(at, `${m.name}: ${m.startLine}-${m.endLine} spans ${span} lines but loc is ${m.loc}`);
    }
    if (m.body.includes('${')) {
      fail(at, `${m.name}: body contains a template-literal interpolation`);
    }
  }

  // Predicted is not proven.
  if (cluster.hasProvenDivergence && cluster.divergence && !cluster.divergence.executed) {
    fail(at, 'hasProvenDivergence is true but divergence.executed is false');
  }
  if (cluster.hasProvenDivergence && !cluster.divergence) {
    fail(at, 'hasProvenDivergence is true but there is no divergence at all');
  }

  if (!cluster.divergence) return;

  const anyDiverged = cluster.divergence.rows.some((r) => r.diverged);
  if (cluster.divergence.executed && anyDiverged && !cluster.hasProvenDivergence) {
    fail(at, 'executed rows diverge but hasProvenDivergence is false');
  }

  cluster.divergence.rows.forEach((row, i) => {
    const rowAt = `${at} row ${i} (${row.input})`;

    if (row.results.length !== cluster.members.length) {
      fail(rowAt, `${row.results.length} results for ${cluster.members.length} members`);
    }
    for (const r of row.results) {
      if (!ids.has(r.functionId)) fail(rowAt, `result for unknown functionId ${r.functionId}`);
    }

    // THE IMPORTANT ONE. A row that claims divergence while every cell shows
    // the same answer is a lie on screen.
    const distinct = new Set(row.results.map(key));
    const reallyDiverged = distinct.size > 1;
    if (row.diverged !== reallyDiverged) {
      fail(
        rowAt,
        `diverged: ${row.diverged} but the ${distinct.size} distinct output(s) say ${reallyDiverged} — [${[...distinct].join(' | ')}]`,
      );
    }
  });
}

function auditRepo(entry) {
  const { repo, stats, clusters, details } = entry;
  const at = repo.id;

  if (stats.semanticDuplicateClusters !== details.length) {
    fail(at, `stats say ${stats.semanticDuplicateClusters} clusters, fixture has ${details.length}`);
  }
  // `behavioralConflicts` is the SUSPECTED count (adjudicator-flagged) and is a
  // superset of what was executed and proven. It may exceed the proven count —
  // it must never be smaller, which would mean claiming proof we never had.
  const proven = details.filter((c) => c.hasProvenDivergence).length;
  if (stats.behavioralConflicts < proven) {
    fail(
      at,
      `stats say ${stats.behavioralConflicts} suspected conflicts but ${proven} clusters are proven — suspected can never be fewer than proven`,
    );
  }
  const lines = details.reduce((t, c) => t + c.linesRemovable, 0);
  if (stats.linesRemovable !== lines) {
    fail(at, `stats say ${stats.linesRemovable} lines removable, clusters sum to ${lines}`);
  }
  if (clusters.length !== details.length) {
    fail(at, `summary list has ${clusters.length} entries, details have ${details.length}`);
  }
  if (stats.healthScore < 0 || stats.healthScore > 100) {
    fail(at, `healthScore ${stats.healthScore} out of range`);
  }

  for (const cluster of details) auditCluster(repo.id, cluster);
}

try {
  const indexPath = compile();
  const { REPOS_FOR_AUDIT } = await import(pathToFileURL(indexPath).href);

  let clusterCount = 0;
  let rowCount = 0;
  for (const entry of REPOS_FOR_AUDIT) {
    auditRepo(entry);
    clusterCount += entry.details.length;
    for (const c of entry.details) rowCount += c.divergence?.rows.length ?? 0;
  }

  if (problems.length > 0) {
    console.error(`\n✗ ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  · ${p}`);
    console.error('');
    process.exitCode = 1;
  } else {
    console.log(
      `\n✓ fixtures consistent — ${REPOS_FOR_AUDIT.length} repos, ${clusterCount} clusters, ${rowCount} divergence rows\n`,
    );
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
