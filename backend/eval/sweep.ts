/**
 * THRESHOLD SWEEP — turns Ditto's asserted similarity cut-offs into measured
 * precision / recall / F1 on a labeled pair set.
 *
 * Fully offline: it reads the committed fixture `labeled-pairs.json` (which
 * carries the stored embeddings inline) and reuses the SAME cosine the product
 * clusters and guards with — imported from Services/cluster.service.ts, never
 * reimplemented. It opens NO database connection, so it cannot touch production.
 *
 *   npx tsx backend/eval/sweep.ts
 *
 * Convention: a pair is PREDICTED a clone when cosine(a, b) >= threshold. We
 * sweep the threshold across [0.60, 0.95] in 0.01 steps and, at each step,
 * report the confusion matrix against the human-auditable labels.
 */
import { readFileSync } from 'node:fs';

import { cosineSimilarity } from '../src/Services/cluster.service.js';

// --- product operating points, kept in sync with the services they come from ---
const CLUSTER_THRESHOLD = 0.75; // SIMILARITY_THRESHOLD in cluster.service.ts
const GUARD_FLOOR = 0.8; //        GUARD_SEARCH_FLOOR in guard.service.ts

interface FixtureFunction {
  repo: string;
  name: string;
  file: string;
  bodyHash: string;
  domain: string;
  intent: string;
  arity: number;
  isPure: boolean;
  inputs: string[];
  outputs: string[];
  embedding: number[];
}

interface FixturePair {
  a: string;
  b: string;
  label: 'clone' | 'not-clone';
  cosine: number;
  rationale: string;
}

interface Fixture {
  meta: Record<string, unknown> & { counts?: Record<string, number> };
  functions: Record<string, FixtureFunction>;
  pairs: FixturePair[];
}

const fixturePath = new URL('./labeled-pairs.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

// Resolve each pair to its measured cosine, computed with the PRODUCT function on
// the stored vectors — no recomputation of embeddings, no API calls.
interface ScoredPair {
  isClone: boolean;
  cosine: number;
}
const scored: ScoredPair[] = fixture.pairs.map((p) => {
  const a = fixture.functions[p.a];
  const b = fixture.functions[p.b];
  if (!a || !b) throw new Error(`pair references unknown function: ${p.a} / ${p.b}`);
  return { isClone: p.label === 'clone', cosine: cosineSimilarity(a.embedding, b.embedding) };
});

const positives = scored.filter((s) => s.isClone);
const negatives = scored.filter((s) => !s.isClone);

interface Row {
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number; // NaN when no positive predictions
  recall: number;
  f1: number; // 0 when undefined, so it composes cleanly in argmax
}

const evaluate = (threshold: number): Row => {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const s of scored) {
    const predClone = s.cosine >= threshold;
    if (s.isClone && predClone) tp += 1;
    else if (!s.isClone && predClone) fp += 1;
    else if (s.isClone && !predClone) fn += 1;
    else tn += 1;
  }
  const precision = tp + fp === 0 ? NaN : tp / (tp + fp);
  const recall = tp + fn === 0 ? NaN : tp / (tp + fn);
  // Harmonic-mean form that stays defined (=0) when there are no true positives.
  const f1 = 2 * tp + fp + fn === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  return { threshold, tp, fp, fn, tn, precision, recall, f1 };
};

const rows: Row[] = [];
for (let i = 60; i <= 95; i += 1) rows.push(evaluate(i / 100));

const fmt = (x: number): string => (Number.isNaN(x) ? '  -  ' : x.toFixed(3));
const stats = (xs: number[]): string => {
  if (xs.length === 0) return 'n/a';
  const sorted = [...xs].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return `min=${min.toFixed(3)} median=${median.toFixed(3)} mean=${mean.toFixed(3)} max=${max.toFixed(3)}`;
};

// F1-optimal threshold (lowest threshold that achieves the max F1).
const bestF1 = Math.max(...rows.map((r) => r.f1));
const optimal = rows.find((r) => r.f1 === bestF1)!;

console.log('='.repeat(72));
console.log('DITTO SIMILARITY THRESHOLD SWEEP');
console.log('='.repeat(72));
console.log(`pairs: ${scored.length}  (positives=${positives.length}, negatives=${negatives.length})`);
console.log(`unique functions: ${Object.keys(fixture.functions).length}`);
console.log(`positive-pair cosine: ${stats(positives.map((s) => s.cosine))}`);
console.log(`negative-pair cosine: ${stats(negatives.map((s) => s.cosine))}`);
console.log('');
console.log('thr     TP  FP  FN  TN   precision  recall     F1     note');
console.log('-'.repeat(72));
for (const r of rows) {
  const notes: string[] = [];
  if (Math.abs(r.threshold - CLUSTER_THRESHOLD) < 1e-9) notes.push('<< cluster 0.75');
  if (Math.abs(r.threshold - GUARD_FLOOR) < 1e-9) notes.push('<< guard 0.80');
  if (r.threshold === optimal.threshold) notes.push('<< F1-optimal');
  const cols =
    `${r.threshold.toFixed(2)}   ` +
    `${String(r.tp).padStart(3)} ${String(r.fp).padStart(3)} ` +
    `${String(r.fn).padStart(3)} ${String(r.tn).padStart(3)}    ` +
    `${fmt(r.precision)}     ${fmt(r.recall)}   ${fmt(r.f1)}   ` +
    notes.join('  ');
  console.log(cols.trimEnd());
}
console.log('-'.repeat(72));

const line = (label: string, r: Row): void => {
  console.log(
    `${label.padEnd(22)} thr=${r.threshold.toFixed(2)}  ` +
      `precision=${fmt(r.precision)}  recall=${fmt(r.recall)}  F1=${fmt(r.f1)}  ` +
      `(TP=${r.tp} FP=${r.fp} FN=${r.fn} TN=${r.tn})`
  );
};
const at = (t: number): Row => rows.find((r) => Math.abs(r.threshold - t) < 1e-9)!;
console.log('');
console.log('OPERATING POINTS');
line('cluster (0.75)', at(CLUSTER_THRESHOLD));
line('guard  (0.80)', at(GUARD_FLOOR));
line('F1-optimal', optimal);
console.log('');
console.log(
  `F1-optimal threshold = ${optimal.threshold.toFixed(2)} (F1=${optimal.f1.toFixed(3)}). ` +
    'Labels derive from Ditto\'s own clustering — read this as calibration, not an independent gold set.'
);
