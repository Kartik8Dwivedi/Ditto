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
}

export interface CandidateCluster {
  memberIds: string[];
  /** Mean pairwise cosine similarity — why these were grouped. */
  cohesion: number;
  /** Distinct modules the members span. >1 means suspected reinvention. */
  moduleCount: number;
}

export interface ClusterOptions {
  /** Average-linkage merge threshold. */
  threshold?: number;
  /** Edge floor for building candidate components. */
  mergeFloor?: number;
  maxClusterSize?: number;
  maxClusters?: number;
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
export const isCompatible = (a: ClusterableFunction, b: ClusterableFunction): boolean => {
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
 * O(k³) in the component size k, which is tiny — components only exist along
 * edges at or above `MERGE_FLOOR`.
 */
const averageLinkage = (
  component: number[],
  simOf: (a: number, b: number) => number,
  threshold: number,
  maxSize: number
): number[][] => {
  // Local dense sim table over the component's members.
  const n = component.length;
  const base: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const s = simOf(component[i], component[j]);
      base[i][j] = s;
      base[j][i] = s;
    }
  }

  let groups: number[][] = component.map((_index, i) => [i]); // indices INTO component
  // Mean similarity between two groups of local indices.
  const groupSim = (a: number[], b: number[]): number => {
    let total = 0;
    for (const x of a) for (const y of b) total += base[x][y];
    return total / (a.length * b.length);
  };

  for (;;) {
    let bestI = -1;
    let bestJ = -1;
    let best = threshold;
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        if (groups[i].length + groups[j].length > maxSize) continue;
        const s = groupSim(groups[i], groups[j]);
        if (s >= best) {
          best = s;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestI === -1) break;
    groups[bestI] = groups[bestI].concat(groups[bestJ]);
    groups = groups.filter((_group, index) => index !== bestJ);
  }

  // Map local indices back to the caller's indices; keep only real clusters.
  return groups
    .filter((group) => group.length >= 2)
    .map((group) => group.map((local) => component[local]));
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
  const {
    threshold = SIMILARITY_THRESHOLD,
    mergeFloor = MERGE_FLOOR,
    maxClusterSize = MAX_CLUSTER_SIZE,
    maxClusters = MAX_CANDIDATE_CLUSTERS,
  } = options;

  const usable = functions.filter((fn) => fn.embedding.length > 0);
  if (usable.length < 2) return [];

  const vectors = usable.map((fn) => normalise(fn.embedding));

  // Compatibility-and-length-aware similarity. Incompatible or unlike-length
  // pairs are -Infinity so they can never merge.
  const simOf = (a: number, b: number): number => {
    if (a === b) return 1;
    if (!isCompatible(usable[a], usable[b])) return -Infinity;
    if (vectors[a].length !== vectors[b].length) return -Infinity;
    return dot(vectors[a], vectors[b]);
  };

  // Bucket first: comparing across (arity, purity) buckets is provably wasted.
  const buckets = new Map<string, number[]>();
  usable.forEach((fn, index) => {
    const key = `${arityBucket(fn.arity)}:${fn.isPure}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  });

  // Union-find over above-floor compatible edges → candidate components.
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
      clusters.push({
        memberIds: group.map((index) => usable[index].id),
        cohesion: meanPairwise(group, simOf),
        moduleCount: modules.size,
      });
    }
  }

  // Order by VALUE, not tightness, then bound the adjudication bill. A pure
  // cohesion sort spends the budget on exact copies (which token tools already
  // find) and starves the cross-module Type-4 clones that are the whole point.
  clusters.sort((a, b) => candidatePriority(b) - candidatePriority(a) || b.cohesion - a.cohesion);
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
  const notExactDuplicate = cluster.cohesion < EXACT_DUPLICATE_COHESION ? 1 : 0;
  return crossModule + notExactDuplicate;
};
