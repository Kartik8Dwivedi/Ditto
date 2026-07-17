export { default as IndexerService, DEFAULT_CACHE_DIR, cacheFileFor } from './indexer.service.js';
export type { CacheFile, IndexOptions, IndexReport } from './indexer.service.js';

export { extractFromSource, explainPurity, hashBody } from './extract.js';
export type { ExtractionResult } from './extract.js';

export { isSourceFile, skipReason, MIN_FUNCTION_LOC } from './filter.js';

export { analyseFilePurity, analyseLocalPurity, buildFileScope, returnsAValue } from './purity.js';
export type { FileScope, LocalPurity } from './purity.js';

export { fetchRepoFiles } from './github.js';
export type { FetchedRepo, FetchOptions } from './github.js';
