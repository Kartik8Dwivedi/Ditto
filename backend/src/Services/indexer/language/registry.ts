import { tsMorphAdapter } from './adapter.js';
import type { LanguageAdapter } from './adapter.js';
import { pythonAdapter } from './python/adapter.js';

const adapters: LanguageAdapter[] = [
  tsMorphAdapter,
  pythonAdapter,
];

/** Check if any registered language adapter accepts this path */
export const isAnySourceFile = (path: string): boolean => {
  return adapters.some((adapter) => adapter.isSourceFile(path));
};

/** Retrieve the matching language adapter for a given file path */
export const adapterFor = (path: string): LanguageAdapter | null => {
  return adapters.find((adapter) => adapter.isSourceFile(path)) ?? null;
};