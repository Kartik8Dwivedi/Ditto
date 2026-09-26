import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveProbeFile } from '../src/Services/probe/shared/worker-paths.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;

describe('resolveProbeFile', () => {
  const importMetaUrl = new URL(import.meta.url).href;
  const currentDir = dirname(fileURLToPath(importMetaUrl));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return direct path when file exists at direct path', () => {
    mockExistsSync.mockReturnValueOnce(true); // direct path exists
    const result = resolveProbeFile(importMetaUrl, 'test-probe.js');
    expect(result).toBe(join(currentDir, 'test-probe.js'));
  });

  it('should return direct path when file does not exist and no .js suffix', () => {
    mockExistsSync.mockReturnValueOnce(false); // direct path doesn't exist
    const result = resolveProbeFile(importMetaUrl, 'test-probe.bin');
    expect(result).toBe(join(currentDir, 'test-probe.bin'));
  });

  it('should return .ts variant when .js file does not exist but .ts does', () => {
    mockExistsSync.mockReturnValueOnce(false);
    mockExistsSync.mockReturnValueOnce(true);
    const result = resolveProbeFile(importMetaUrl, 'test-probe.js');
    expect(result).toBe(join(currentDir, 'test-probe.ts'));
  });

  it('should return direct .js path when neither exists', () => {
    mockExistsSync.mockReturnValueOnce(false);
    mockExistsSync.mockReturnValueOnce(false);
    const result = resolveProbeFile(importMetaUrl, 'test-probe.js');
    expect(result).toBe(join(currentDir, 'test-probe.js'));
  });

  it('should prefer direct .js path over .ts variant when both exist', () => {
    mockExistsSync.mockReturnValueOnce(true);
    const result = resolveProbeFile(importMetaUrl, 'test-probe.js');
    expect(result).toBe(join(currentDir, 'test-probe.js'));
  });

  it('should handle .ts file name (no .js suffix conversion)', () => {
    mockExistsSync.mockReturnValueOnce(true);
    const result = resolveProbeFile(importMetaUrl, 'test-probe.ts');
    expect(result).toBe(join(currentDir, 'test-probe.ts'));
  });

  it('should work with nested directory paths', () => {
    mockExistsSync.mockReturnValueOnce(true);
    const result = resolveProbeFile(importMetaUrl, 'subdir/test-probe.js');
    expect(result).toContain('subdir/test-probe.js');
  });

  it('should return direct path when .js file exists but .ts also exists (direct takes priority)', () => {
    mockExistsSync.mockReturnValueOnce(true);
    const result = resolveProbeFile(importMetaUrl, 'test-probe.js');
    expect(result).toBe(join(currentDir, 'test-probe.js'));
  });
});
