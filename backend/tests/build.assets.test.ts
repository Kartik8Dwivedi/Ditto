import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error copy-assets is a plain JS build utility
import { assets } from '../scripts/copy-assets.js';

describe('Build Assets', () => {
  it('asserts that every asset declared in copy-assets.js exists at source', () => {
    expect(assets.length).toBeGreaterThan(0);

    for (const asset of assets) {
      expect(existsSync(asset.src)).toBe(true);
    }
  });

  it('asserts that compiled assets exist if dist directory is present', () => {
    const currentDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
    const distDir = resolve(currentDir, '../dist');

    if (existsSync(distDir)) {
      for (const asset of assets) {
        expect(existsSync(asset.dest)).toBe(true);
      }
    }
  });
});
