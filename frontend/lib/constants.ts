/**
 * Ditto caps analysis at 1500 functions per repo (see docs/DITTO_PLAN.md §2).
 * When a repo hits the cap the UI must say so — silently analysing a slice of
 * someone's codebase and presenting it as the whole picture would be a lie of
 * omission.
 */
export const ANALYSIS_FUNCTION_CAP = 1500;

/** The pipeline stages, in the order the backend really runs them. */
export const PIPELINE_STAGES = [
  { id: 'parse', label: 'Parsing AST', detail: 'ts-morph walk over every function, method and arrow' },
  { id: 'fingerprint', label: 'Fingerprinting functions', detail: 'one LLM call per function, constant context' },
  { id: 'embed', label: 'Embedding fingerprints', detail: 'intent and behaviour — never the function name' },
  { id: 'cluster', label: 'Clustering', detail: 'cosine similarity + signature/purity compatibility' },
  { id: 'adjudicate', label: 'Adjudicating clusters', detail: 'flagship model reads one cluster at a time' },
  { id: 'probe', label: 'Probing for divergence', detail: 'executing pure members on adversarial inputs' },
] as const;
