import { isSourceFile } from '../filter.js';
import { extractFromSource } from '../extract.js';
import type { ExtractionResult } from '../extract.js';

export interface LanguageAdapter {
  isSourceFile(path: string): boolean;
  extract(file: string, contents: string): ExtractionResult;
}

export const tsMorphAdapter: LanguageAdapter = {
  isSourceFile,
  extract: extractFromSource,
};

export default tsMorphAdapter;