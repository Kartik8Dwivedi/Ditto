import { describe, it, expect } from 'vitest';
import { executeSandboxedWorker } from '../src/Services/probe/shared/worker-harness.js';
import { resolveProbeFile } from '../src/Services/probe/shared/worker-paths.js';
import { readFileSync } from 'node:fs';

describe('Pyodide Worker Memory Constraint', { timeout: 30000 }, () => {
  it('executes Pyodide under maxOldGenerationSizeMb: 128 without OOM', async () => {
    const workerPath = resolveProbeFile(
      import.meta.url,
      '../src/Services/probe/languages/python/python.worker.js'
    );
    const harnessPath = resolveProbeFile(
      import.meta.url,
      '../src/Services/probe/languages/python/harness.py'
    );

    const result = await executeSandboxedWorker({
      workerPath,
      memberCount: 1,
      inputCount: 1,
      workerData: {
        harnessSource: readFileSync(harnessPath, 'utf-8'),
        timeoutMs: 5000,
        maxDisplayChars: 1000,
        interruptBuffer: new Int32Array(new SharedArrayBuffer(4)),
        members: [{ id: 'm1', body: 'def test():\n    return 42' }],
        inputs: ['[]'],
      },
    });

    expect(result).toBeDefined();
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]?.output).toBe('42');
  });
});
