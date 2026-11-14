/**
 * CLUSTERING — deterministic, no LLM, zero tokens.
 *
 * This is the stage that makes Ditto affordable. The flagship model must never
 * see the O(n²) cross-product of a repo; it only ever sees the handful of
 * candidate clusters that survive this file. Everything here is arithmetic over
 * vectors we already bought in stage 2.
 *
 * At ~3000 functions the full similarity matrix is a few million pairs — plain
 * in-memory arithmetic, no vector database. Atlas Vector Search is a distraction
 * at this scale and adds a moving part we would have to demo.
 *
 * Clustering is average-linkage over connected components (see
 * findCandidateClusters). Average, not complete, linkage: the members we group
 * are Type-4 clones, which DIFFER, so a tight all-pairs rule splits exactly the
 * clusters we exist to find.
 */

/**
 * AVERAGE-linkage merge threshold: two groups join when their MEAN cross-pair
 * cosine clears this.
 *
 * Deliberately generous (0.75, down from an earlier 0.86). This stage only
 * proposes candidates; the flagship adjudicator is the precision gate and
 * already rejects roughly half of what it sees. A tight threshold here does the
 * opposite of what we want — it splits the very clusters we exist to find,
 * because Type-4 clones differ, so some of their pairwise similarities are low
 * by construction. Better to form a generous candidate and let the adjudicator
 * say no than to never form it at all.
 */
export const SIMILARITY_THRESHOLD = 0.75;

/**
 * Edge floor for building candidate COMPONENTS. A pair this similar is worth
 * considering as belonging together; the graph's connected components become the
 * search space for average-linkage. Lower than the merge threshold on purpose:
 * a cluster of divergent implementations can contain a pair below the merge
 * threshold as long as the group's *average* clears it, so the component must be
 * connected by the weaker links too.
 */
export const MERGE_FLOOR = 0.7;

/**
 * The flagship is handed a small cluster and never more. Larger than the earlier
 * 5 because a generous threshold forms bigger candidates; still small enough
 * that one adjudication call stays cheap and its context stays constant.
 */
export const MAX_CLUSTER_SIZE = 8;

/**
 * Upper bound on candidate clusters we pay the flagship to adjudicate, taken
 * from the highest-cohesion end since those are the strongest clone signals.
 * Each candidate is ~₹1.75 of adjudication (the flagship writes detailed
 * differences), so this cap is a direct cost lever. ~100 ≈ ₹85 for a ~2600-fn
 * repo. Candidates are ordered by {@link candidatePriority}, NOT by raw cohesion,
 * so the cap keeps the interesting clusters rather than the tightest.
 */
export const MAX_CANDIDATE_CLUSTERS = 100;

/**
 * At or above this cohesion a cluster is a near-EXACT duplicate — Type-1/2, the
 * copy-paste a token tool like jscpd already finds. Ditto's value is the Type-4
 * semantic clone, which is implemented DIFFERENTLY and therefore has lower
 * cohesion. So exact duplicates are ranked BEHIND everything else for the
 * adjudication budget: we do not spend the flagship on what jscpd catches free.
 */
export const EXACT_DUPLICATE_COHESION = 0.985;

/** Arity 3 and arity 7 are in the same bucket; arity 1 and 2 are not. */
const arityBucket = (arity: number): number => Math.min(arity, 3);

/** Types that tell us nothing and should not block a match. */
const WILDCARD_TYPES = new Set(['unknown', 'any', '']);

/** The directory a file lives in — our unit of "module". */
const moduleOf = (file: string): string => {
  const cut = file.lastIndexOf('/');
  return cut <= 0 ? '.' : file.slice(0, cut);
};

export interface ClusterableFunction {
  id: string;
  /** Embedding of the FINGERPRINT — see embedding.service.ts. */
  embedding: number[];
  /** Number of declared parameters. */
  arity: number;
  isPure: boolean;
  /** Fingerprint input types. */
  inputs: string[];
  /** Fingerprint output types. */
  outputs: string[];
  /** Repo-relative path, used to prioritise cross-module clusters. Optional. */
  file?: string;
  language: 'ts' | 'python'
}

export interface CandidateCluster {
  memberIds: string[];
  /** Mean pairwise cosine similarity — why these were grouped. */
  cohesion: number;
  /** Distinct modules the members span. >1 means suspected reinvention. */
  moduleCount: number;
  languageCount?: number;
}

export interface ClusteringStats {
  components: number;
  largestComponent: number;
  pairsComputed: number;
  ms: number;
}

export interface ClusterOptions {
  /** Average-linkage merge threshold. */
  threshold?: number;
  /** Edge floor for building candidate components. */
  mergeFloor?: number;
  maxClusterSize?: number;
  maxClusters?: number;
  crossLanguage?: 'allow' | 'deny';
  onStats?: (stats: ClusteringStats) => void;
}

/**
 * Standard cosine similarity. Returns 0 for mismatched or zero-length vectors
 * rather than NaN — an uncomparable pair is simply not similar.
 */
export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
};

/** Unit-length copy, so similarity collapses to a plain dot product. */
const normalise = (vector: number[]): number[] => {
  let mag = 0;
  for (const value of vector) mag += value * value;
  mag = Math.sqrt(mag);
  if (mag === 0) return vector.slice();
  return vector.map((value) => value / mag);
};

const dot = (a: number[], b: number[]): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
};

interface PreparedFunction {
  fn: ClusterableFunction;
  arityBucket: number;
  inputs: string[];
  outputs: string[];
}

const prepareFunction = (fn: ClusterableFunction): PreparedFunction => ({
  fn,
  arityBucket: arityBucket(fn.arity),
  inputs: fn.inputs.map(normaliseType),
  outputs: fn.outputs.map(normaliseType),
});

const preparedTypesMatch = (left: string, right: string): boolean =>
  WILDCARD_TYPES.has(left) || WILDCARD_TYPES.has(right) || left === right;

const isPreparedCompatible = (
  a: PreparedFunction,
  b: PreparedFunction,
  crossLanguage?: 'allow' | 'deny'
): boolean => {
  if (crossLanguage === 'deny' && a.fn.language !== b.fn.language) return false;
  if (a.fn.isPure !== b.fn.isPure) return false;
  if (a.arityBucket !== b.arityBucket) return false;

  const outputsOverlap =
    a.outputs.length === 0 ||
    b.outputs.length === 0 ||
    a.outputs.some((left) =>
      b.outputs.some((right) => preparedTypesMatch(left, right))
    );
  if (!outputsOverlap) return false;

  const shared = Math.min(a.inputs.length, b.inputs.length);
  for (let i = 0; i < shared; i += 1) {
    if (!preparedTypesMatch(a.inputs[i], b.inputs[i])) return false;
  }
  return true;
};

/** `string | null` and `String` are the same claim about shape. */
const normaliseType = (type: string): string =>
  type
    .toLowerCase()
    .replace(/\s*\|\s*(null|undefined)/g, '')
    .replace(/\?$/, '')
    .trim();

const typesMatch = (a: string, b: string): boolean => {
  const left = normaliseType(a);
  const right = normaliseType(b);
  if (WILDCARD_TYPES.has(left) || WILDCARD_TYPES.has(right)) return true;
  return left === right;
};

/**
 * The compatibility pre-filter — free, and it removes most of the cross-product
 * before a single dot product is computed.
 *
 * Two functions cannot be the same behaviour if they take a different number of
 * things, disagree about purity, or produce a different kind of value. Purity
 * matters twice over: it decides whether the prober may execute them at all.
 */
export const isCompatible = (
  a: ClusterableFunction,
  b: ClusterableFunction,
  options?: ClusterOptions
): boolean => {
  if (options?.crossLanguage === 'deny' && a.language !== b.language) {
    return false;
  }
  if (a.isPure !== b.isPure) return false;
  if (arityBucket(a.arity) !== arityBucket(b.arity)) return false;

  // Outputs must be able to be the same kind of thing.
  const outputsOverlap =
    a.outputs.length === 0 ||
    b.outputs.length === 0 ||
    a.outputs.some((left) => b.outputs.some((right) => typesMatch(left, right)));
  if (!outputsOverlap) return false;

  // Inputs must line up positionally as far as both are declared. The arity
  // bucket already bounds how far apart the counts can be.
  const shared = Math.min(a.inputs.length, b.inputs.length);
  for (let i = 0; i < shared; i += 1) {
    if (!typesMatch(a.inputs[i], b.inputs[i])) return false;
  }
  return true;
};

/** Mean pairwise similarity within a set, via a resolver for each pair. */
const meanPairwise = (members: number[], sim: (a: number, b: number) => number): number => {
  if (members.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      total += sim(members[i], members[j]);
      pairs += 1;
    }
  }
  return pairs === 0 ? 0 : total / pairs;
};

/**
 * Average-linkage agglomerative clustering within ONE connected component.
 *
 * Repeatedly merges the two groups with the highest mean cross-pair similarity,
 * stopping when the best merge falls below `threshold` or would exceed
 * `maxSize`. Average-linkage (not complete) is the right choice here precisely
 * because the members we want to group DIFFER — a divergent implementation drags
 * one pairwise score down, and complete-linkage would split the cluster on that
 * single weak edge. The mean tolerates it; the adjudicator then rules on it.
 *
 * Incompatible pairs are held at -Infinity so a group can never absorb a member
 * of an incompatible shape (their mean collapses to -Infinity).
 *
 * Performance optimization: pre-compute all pairwise similarities once, then use
 * Lance-Williams incremental update formula to compute new group-pair scores per
 * merge in O(groups) instead of O(k²). This replaces naive O(k³) recalculation.
 */
const averageLinkage = (
  component: number[],
  simOf: (a: number, b: number) => number,
  threshold: number,
  maxSize: number
): number[][] => {
  const n = component.length;

  // Use Float64Array (1D flat layout) for cache locality and full double precision.
  // base[i * n + j] = cosine similarity between component[i] and component[j].
  const base = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const s = simOf(component[i], component[j]);
      base[i * n + j] = s;
      base[j * n + i] = s;
    }
  }

  // gs[si * n + sj] = current group-pair similarity, updated by Lance-Williams formula.
  const gs = Float64Array.from(base);
  
  const members: number[][] = component.map((_c, i) => [i]);
  
  // order = list of living group IDs after merges. Sparse: [0, 1, 2, 5] after groups 3,4 merged.
  const order: number[] = members.map((_m, i) => i);

  for (;;) {
    let bestI = -1;
    let bestJ = -1;
    let best = threshold;

    for (let i = 0; i < order.length; i += 1) {
      const si = order[i];
      for (let j = i + 1; j < order.length; j += 1) {
        const sj = order[j];
        if (members[si].length + members[sj].length > maxSize) continue;

        const s = gs[si * n + sj];
        if (s >= best) {
          best = s;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestI === -1) break;

    const si = order[bestI];
    const sj = order[bestJ];
    const oldSizeA = members[si].length;
    const oldSizeB = members[sj].length;
    
    members[si] = members[si].concat(members[sj]);
    order.splice(bestJ, 1);

    // Lance-Williams update: recompute group-pair similarities with weighted average.
// Formula: newScore = (oldSizeA * scoreA + oldSizeB * scoreB) / (oldSizeA + oldSizeB)
// This avoids O(|si| × |sj|) recalculation for each merge.
    for (let p = 0; p < order.length; p += 1) {
      const sc = order[p];
      if (sc === si) continue;

      const scoreA = gs[si * n + sc];
      const scoreB = gs[sj * n + sc];
      const newScore = (oldSizeA * scoreA + oldSizeB * scoreB) / members[si].length;

      gs[si * n + sc] = newScore;
      gs[sc * n + si] = newScore;
    }
  }

  // Extract final clusters: convert living group IDs back to component-global indices.
  // Filter out singletons (clusters must have ≥2 members to be meaningful).
  return order
    .filter((slot) => members[slot].length >= 2)
    .map((slot) => members[slot].map((local) => component[local]));
};

/**
 * Group functions that do the same thing.
 *
 * Two stages, both zero-token:
 *   1. Build candidate COMPONENTS — connected components of the graph whose edges
 *      are compatible pairs at or above `mergeFloor`. This is the search-space
 *      prune: the flagship never sees the cross-product, only these.
 *   2. Within each component, run average-linkage to settle the actual clusters.
 *
 * Why components first: average-linkage is O(k³), so it must run on small sets.
 * An edge floor below the merge threshold keeps components connected through the
 * weaker links a divergent cluster legitimately contains, while still bounding
 * their size.
 */
export const findCandidateClusters = (
  functions: ClusterableFunction[],
  options: ClusterOptions = {}
): CandidateCluster[] => {
  const startedAt = performance.now();

  const {
    threshold = SIMILARITY_THRESHOLD,
    mergeFloor = MERGE_FLOOR,
    maxClusterSize = MAX_CLUSTER_SIZE,
    maxClusters = MAX_CANDIDATE_CLUSTERS,
    crossLanguage,
    onStats
  } = options;

  const usable = functions.filter((fn) => fn.embedding.length > 0);
  if (usable.length < 2) {
    onStats?.({ components: 0, largestComponent: 0, pairsComputed: 0, ms: performance.now() - startedAt });
    return [];
  }

  const prepared = usable.map(prepareFunction);
  const vectors = usable.map((fn) => normalise(fn.embedding));

// Skip cross-bucket comparisons: different arity or purity cannot be same behaviour.
  // Memoization: every within-bucket pair is computed once and cached.
  // simOf reads from pairCache on subsequent calls (Union-Find pass, averageLinkage, meanPairwise).
  // pairsComputed tracks actual dot product computations for metrics and diagnostics.
  const pairCache = new Map<number, number>();
  let pairsComputed = 0;

  const pairKey = (a: number, b: number): number => {
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    return low * usable.length + high;
  };

  const simOf = (a: number, b: number): number => {
    if (a === b) return 1;

    const key = pairKey(a, b);
    if (pairCache.has(key)) return pairCache.get(key) as number;

    // Compatibility-and-length-aware similarity: incompatible or mismatched pairs return -Infinity
    // so they never merge
    let score = -Infinity;
    if (
      isPreparedCompatible(prepared[a], prepared[b], crossLanguage) &&
      vectors[a].length === vectors[b].length
    ) {
      score = dot(vectors[a], vectors[b]);
      pairsComputed += 1;
    }

    pairCache.set(key, score);
    return score;
  };

  const buckets = new Map<string, number[]>();
  usable.forEach((fn, index) => {
    const key = `${prepared[index].arityBucket}:${fn.isPure}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  });

  // Build connected components using Union-Find at MERGE_FLOOR threshold.
  // Single-linkage: one edge ≥ 0.70 joins two functions into the same component.
  const parent = usable.map((_fn, index) => index);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (const indices of buckets.values()) {
    for (let i = 0; i < indices.length; i += 1) {
      for (let j = i + 1; j < indices.length; j += 1) {
        if (simOf(indices[i], indices[j]) >= mergeFloor) union(indices[i], indices[j]);
      }
    }
  }

  const components = new Map<number, number[]>();
  for (let i = 0; i < usable.length; i += 1) {
    const root = find(i);
    const bucket = components.get(root);
    if (bucket) bucket.push(i);
    else components.set(root, [i]);
  }

  const clusters: CandidateCluster[] = [];
  for (const component of components.values()) {
    if (component.length < 2) continue;
    for (const group of averageLinkage(component, simOf, threshold, maxClusterSize)) {
      const modules = new Set(group.map((index) => moduleOf(usable[index].file ?? '')));
      const languages = new Set(group.map((index) => usable[index].language));
      clusters.push({
        memberIds: group.map((index) => usable[index].id),
        cohesion: meanPairwise(group, simOf),
        moduleCount: modules.size,
        languageCount: languages.size,
      });
    }
  }

  // Order by VALUE, not tightness, then bound the adjudication bill. A pure
  // cohesion sort spends the budget on exact copies (which token tools already
  // find) and starves the cross-module Type-4 clones that are the whole point.
  clusters.sort((a, b) => candidatePriority(b) - candidatePriority(a) || b.cohesion - a.cohesion);

  const componentList = [...components.values()];
  const stats: ClusteringStats = {
    components: componentList.length,
    largestComponent: componentList.reduce(
      (largest, comp) => Math.max(largest, comp.length),
      0
    ),
    pairsComputed,
    ms: performance.now() - startedAt
  };
  onStats?.(stats);

  return clusters.slice(0, maxClusters);
};

/**
 * How worth-adjudicating a candidate is, higher first. Two signals, both aligned
 * with what Ditto exists to surface:
 *   +2  spans more than one module — suspected reinvention, not local copy-paste
 *   +1  is NOT a near-exact duplicate — a real Type-4 clone, not jscpd's job
 * Cohesion breaks ties (see the caller), so within a tier the tightest win.
 */
export const candidatePriority = (cluster: CandidateCluster): number => {
  const crossModule = cluster.moduleCount > 1 ? 2 : 0;
  // A cross-language port is a stronger reinvention signal than a same-language
  // local copy, but weaker than a cross-module duplicate within the same codebase.
  const crossLanguage = (cluster.languageCount ?? 1) > 1 ? 1 : 0;
  const notExactDuplicate = cluster.cohesion < EXACT_DUPLICATE_COHESION ? 1 : 0;
  return crossModule + crossLanguage + notExactDuplicate;
};
