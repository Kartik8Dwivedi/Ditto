import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';

import { connectToDB, disconnectFromDB } from '../Config/db.js';
import { RepoRepository, ClusterRepository } from '../Repository/index.js';
import { FunctionModel } from '../Models/index.js';
import AppConfig from '../Config/AppConfig.js';

/**
 * FEASIBILITY PROBE — would a PR-time "drift warning" have anything to say?
 *
 * GitHub API + Mongo reads only. No LLM, no writes, 0 tokens. Responses are
 * cached to disk so a re-run costs no rate limit.
 *
 *   npx tsx src/Scripts/pr-feasibility.ts
 */

const CACHE = path.resolve('.cache/pr-probe');
const TARGETS = [
  { owner: 'cline', name: 'cline' },
  { owner: 'Kuzma02', name: 'Electronics-eCommerce-Shop-With-Admin-Dashboard-NextJS-NodeJS' },
];

interface PrFile {
  filename: string;
  status: string;
  additions: number;
  patch?: string;
}
interface Pr {
  number: number;
  title: string;
  user?: { login: string };
}

const gh = async <T>(url: string, cacheKey: string): Promise<T | null> => {
  const file = path.join(CACHE, `${cacheKey}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    /* not cached yet */
  }
  const headers: Record<string, string> = {
    'user-agent': 'ditto-feasibility-probe',
    accept: 'application/vnd.github+json',
  };
  if (AppConfig.GITHUB_TOKEN) headers.authorization = `Bearer ${AppConfig.GITHUB_TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error(`  ! ${res.status} ${url} (remaining: ${res.headers.get('x-ratelimit-remaining')})`);
    return null;
  }
  const json = (await res.json()) as T;
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(json));
  return json;
};

/** Added line ranges in the NEW file, parsed from unified-diff hunk headers. */
const addedRanges = (patch?: string): Array<[number, number]> => {
  if (!patch) return [];
  const ranges: Array<[number, number]> = [];
  let newLine = 0;
  let runStart = 0;
  let runEnd = 0;
  const flush = (): void => {
    if (runStart) ranges.push([runStart, runEnd]);
    runStart = 0;
  };

  for (const line of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      flush();
      newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith('+')) {
      if (!runStart) runStart = newLine;
      runEnd = newLine;
      newLine += 1;
    } else if (line.startsWith('-')) {
      flush();
    } else {
      flush();
      newLine += 1;
    }
  }
  flush();
  return ranges;
};

/** Does an added line look like a new function declaration? Syntactic only. */
const FUNCTION_PATTERNS = [
  /^\+\s*(export\s+)?(default\s+)?(async\s+)?function\s+\w+/,
  /^\+\s*(export\s+)?(const|let|var)\s+\w+\s*(:[^=]+)?=\s*(async\s+)?(\([^)]*\)|\w+)\s*=>/,
  /^\+\s*(public|private|protected|static|async)?\s*\w+\s*\([^)]*\)\s*(:\s*[^{]+)?\{/,
];
const addedFunctionLines = (patch?: string): string[] =>
  (patch ?? '')
    .split('\n')
    .filter((l) => l.startsWith('+') && FUNCTION_PATTERNS.some((re) => re.test(l)))
    // Exclude obvious control-flow false positives from the third pattern.
    .filter((l) => !/^\+\s*(if|for|while|switch|catch|return)\s*\(/.test(l))
    .map((l) => l.slice(1).trim());

const overlaps = (a: [number, number], b: [number, number]): boolean =>
  a[0] <= b[1] && b[0] <= a[1];

const main = async (): Promise<void> => {
  await connectToDB();
  try {
    const repoRepository = new RepoRepository();
    const clusterRepository = new ClusterRepository();

    for (const target of TARGETS) {
      const slug = `${target.owner}/${target.name}`;
      console.log(`\n${'='.repeat(78)}\n${slug}\n${'='.repeat(78)}`);

      // ---- Mongo side: which functions are in a known duplicate cluster? ----
      const repo = await repoRepository.findLatest(target.owner, target.name);
      if (!repo) {
        console.log(`  MONGO: NOT INDEXED — no analysis exists for this repo.`);
        console.log(`  => cannot produce a drift warning for any PR. Skipping.`);
        continue;
      }
      const repoId = repo._id.toString();
      const clusters = await clusterRepository.findByRepo(repoId);
      const memberIds = [...new Set(clusters.flatMap((c) => c.functionIds.map((i) => i.toString())))];
      const members = await FunctionModel.find({ _id: { $in: memberIds } })
        .select('name file startLine endLine')
        .lean<Array<{ _id: mongoose.Types.ObjectId; name: string; file: string; startLine: number; endLine: number }>>()
        .exec();

      const clusterOf = new Map<string, string>();
      for (const c of clusters) {
        for (const id of c.functionIds) clusterOf.set(id.toString(), c._id.toString());
      }
      const byFile = new Map<string, typeof members>();
      for (const m of members) {
        const list = byFile.get(m.file) ?? [];
        list.push(m);
        byFile.set(m.file, list);
      }

      console.log(`  MONGO: ${clusters.length} clusters, ${members.length} member functions`);
      console.log(`         across ${byFile.size} distinct files at commit ${repo.commit.slice(0, 7)}`);
      const prefixes = [...new Set([...byFile.keys()].map((f) => f.split('/').slice(0, 3).join('/')))];
      console.log(`         indexed path prefixes (sample): ${prefixes.slice(0, 4).join(', ')}`);

      // ---- GitHub side: the 10 most recent open PRs ----
      const prs = await gh<Pr[]>(
        `https://api.github.com/repos/${slug}/pulls?state=open&per_page=10&sort=updated&direction=desc`,
        `${target.owner}-${target.name}-pulls`
      );
      if (!prs) {
        console.log(`  GITHUB: could not list PRs (rate limited?)`);
        continue;
      }
      console.log(`  GITHUB: ${prs.length} open PRs fetched\n`);

      let touching = 0;
      let addingFunctions = 0;
      const examples: string[] = [];
      let filesOverlappingIndexedTree = 0;

      for (const pr of prs) {
        const files = await gh<PrFile[]>(
          `https://api.github.com/repos/${slug}/pulls/${pr.number}/files?per_page=100`,
          `${target.owner}-${target.name}-pr-${pr.number}-files`
        );
        if (!files) continue;

        const hits: string[] = [];
        let addedFns = 0;
        let inIndexedTree = 0;

        for (const f of files) {
          const newFns = addedFunctionLines(f.patch);
          addedFns += newFns.length;

          const candidates = byFile.get(f.filename);
          if (candidates) inIndexedTree += 1;
          if (!candidates) continue;

          const ranges = addedRanges(f.patch);
          for (const fn of candidates) {
            for (const r of ranges) {
              if (overlaps(r, [fn.startLine, fn.endLine])) {
                hits.push(
                  `PR #${pr.number} "${pr.title.slice(0, 48)}" → ${fn.name}() at ` +
                    `${fn.file}:${fn.startLine}-${fn.endLine} (cluster ${clusterOf.get(fn._id.toString())})`
                );
                break;
              }
            }
          }
        }

        if (inIndexedTree > 0) filesOverlappingIndexedTree += 1;
        if (hits.length > 0) {
          touching += 1;
          examples.push(...hits);
        }
        if (addedFns > 0) addingFunctions += 1;

        console.log(
          `  PR #${String(pr.number).padEnd(6)} files=${String(files.length).padStart(3)}  ` +
            `in-indexed-tree=${String(inIndexedTree).padStart(3)}  ` +
            `added-fn-decls=${String(addedFns).padStart(3)}  ` +
            `cluster-hits=${hits.length}`
        );
      }

      console.log(`\n  ---- ${slug} SUMMARY ----`);
      console.log(`  (1) PRs touching a KNOWN-DUPLICATE function ... ${touching} / ${prs.length}`);
      console.log(`  (2) PRs adding at least one new function ...... ${addingFunctions} / ${prs.length}`);
      console.log(`      PRs touching the indexed subtree at all ... ${filesOverlappingIndexedTree} / ${prs.length}`);
      if (examples.length) {
        console.log(`\n  (3) EXAMPLES:`);
        for (const e of examples.slice(0, 5)) console.log(`      - ${e}`);
      } else {
        console.log(`\n  (3) EXAMPLES: none`);
      }
    }
  } finally {
    await disconnectFromDB();
    await mongoose.disconnect();
  }
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
