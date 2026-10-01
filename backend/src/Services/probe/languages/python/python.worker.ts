import { parentPort, workerData } from 'node:worker_threads';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadPyodide } from 'pyodide';
import type { ProbeCell, WorkerResult } from '../../contracts.js';

interface PythonWorkerData {
  /** The harness.py source code as a string (injected into Pyodide globals). */
  harnessSource: string;
  timeoutMs: number;
  members: Array<{ id: string; body: string; preamble?: string }>;
  inputs: string[];
  /** Maximum characters to display before truncating and hashing output. */
  maxDisplayChars: number;
  /**
   * SharedArrayBuffer view for per-call interruption.
   * Main thread writes 2 (SIGINT) to trigger KeyboardInterrupt in Pyodide.
   * Worker resets to 0 before each call.
   */
  interruptBuffer: Int32Array;
}

const data = workerData as PythonWorkerData;

async function run(): Promise<void> {
  const pyodidePackageJson = import.meta.resolve('pyodide/package.json');
  const pyodideDir = dirname(fileURLToPath(pyodidePackageJson));

  const pyodide = await loadPyodide({
    indexURL: pyodideDir,
  });

  // Configure the interrupt buffer for per-call timeout.
  pyodide.setInterruptBuffer(data.interruptBuffer);

  await pyodide.runPythonAsync(data.harnessSource);

  const cells: ProbeCell[] = [];
  const unusable: Array<{ functionId: string; reason: string }> = [];
  const ready: Array<{ id: string; fn: (...args: unknown[]) => unknown }> = [];

  const extractCandidate = pyodide.globals.get('extract_and_prepare_candidate');

  for (const member of data.members) {
    try {
      const memberScope = pyodide.toPy({});

      const targetFn = extractCandidate(member.body, member.preamble ?? null, memberScope);

      if (!targetFn || (typeof targetFn !== 'function' && typeof targetFn.call !== 'function')) {
        unusable.push({
          functionId: member.id,
          reason: 'No callable function found in member body',
        });
      } else {
        ready.push({ id: member.id, fn: targetFn });
      }
    } catch (err) {
      unusable.push({
        functionId: member.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const invokeHelper = pyodide.globals.get('invoke_candidate');

  for (const input of data.inputs) {
    for (const entry of ready) {
      let output = '';
      let error = '';
      let key = '';

      Atomics.store(data.interruptBuffer, 0, 0);
      // Signal main thread to arm the 1000ms interrupt timer in parallel.
      parentPort?.postMessage({ type: 'call_start' });

      try {
        const rawResult: string = invokeHelper(entry.fn, input);

        const result = JSON.parse(rawResult);

        if (result.unserializable) {
          unusable.push({
            functionId: entry.id,
            reason: `Return value could not be serialized: ${result.message}`,
          });
          // Do not emit cells for unserializable returns to prevent false agreement
          continue;
        }

        if (result.ok) {
          const full: string = result.value;
          const isLong = full.length > data.maxDisplayChars;
          // Long outputs: store SHA-256 hash as key, truncate display.
          key =
            'return:' + (isLong ? crypto.createHash('sha256').update(full).digest('hex') : full);
          output = isLong ? full.slice(0, data.maxDisplayChars) + '...' : full;
        } else {
          error = `${result.name}: ${result.message}`;
          key = `throw:${result.name}`;
        }
      } catch (err) {
        // Map KeyboardInterrupt (from interrupt buffer) to throw:Timeout
        // for semantic parity with the JS probe (vm.runInContext timeout).
        const errObj = err as { type?: string; message?: string } | undefined;
        const isInterrupt =
          errObj?.type === 'KeyboardInterrupt' ||
          String(errObj?.message || err).includes('KeyboardInterrupt');

        if (isInterrupt) {
          error = `Timeout: exceeded ${data.timeoutMs}ms`;
          key = 'throw:Timeout';
        } else {
          const name = err instanceof Error ? err.name : 'Error';
          const msg = err instanceof Error ? err.message : String(err);
          error = `${name}: ${msg}`;
          key = `throw:${name}`;
        }
      } finally {
        parentPort?.postMessage({ type: 'call_end' });
      }

      cells.push({
        input,
        functionId: entry.id,
        output,
        error,
        key,
      });
    }
  }

  const response: WorkerResult = { cells, unusable };
  parentPort?.postMessage(response);
}

run().catch((err) => {
  throw err;
});
