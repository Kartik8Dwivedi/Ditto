import { Worker, type WorkerOptions } from 'node:worker_threads';
import { MAX_WORKER_MS, PROBE_TIMEOUT_MS, type WorkerResult } from '../contracts.js';

export interface ExecuteWorkerOptions {
  workerPath: string;
  workerData: Record<string, unknown>;
  memberCount: number;
  inputCount: number;
  options?: Partial<WorkerOptions>;
}

/**
 * Runs a probe language runner (TS or Pyodide) in its own worker thread
 * with a computed timeout and hard memory cap, and resolves once the
 * worker reports back or gets killed for taking too long.
 */
export function executeSandboxedWorker(opts: ExecuteWorkerOptions): Promise<WorkerResult> {
  // Scale the ceiling with the actual workload (one PROBE_TIMEOUT_MS slot
  // per member x input), with a flat 6s cushion for pyodide/tsx cold start.
  // Still capped at MAX_WORKER_MS so a huge cluster can't hang forever.
  const budget = Math.min(
    MAX_WORKER_MS,
    PROBE_TIMEOUT_MS * opts.memberCount * opts.inputCount + 6000
  );

  return new Promise<WorkerResult>((resolve, reject) => {
    const worker = new Worker(opts.workerPath, {
      ...opts.options,
      workerData: opts.workerData,
      stdout: true,
      stderr: true,
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        ...opts.options?.resourceLimits,
      },
    });

    let settled = false;
    let callTimer: NodeJS.Timeout | null = null;
    const interruptBuffer = opts.workerData.interruptBuffer as Int32Array | undefined;

    const clearCallTimer = (): void => {
      if (callTimer) {
        clearTimeout(callTimer);
        callTimer = null;
      }
    };

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearCallTimer();
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`The probe worker exceeded ${budget}ms`)));
    }, budget);

    worker.on('message', (message) => {
      if (message && typeof message === 'object' && 'type' in message) {
        if (message.type === 'call_start') {
          clearCallTimer();
          if (interruptBuffer) {
            Atomics.store(interruptBuffer, 0, 0);
            callTimer = setTimeout(() => {
              Atomics.store(interruptBuffer, 0, 2); // 2 = SIGINT
            }, PROBE_TIMEOUT_MS);
          }
          return;
        }

        if (message.type === 'call_end') {
          clearCallTimer();
          if (interruptBuffer) {
            Atomics.store(interruptBuffer, 0, 0);
          }
          return;
        }
      }

      finish(() => resolve(message as WorkerResult));
    });

    worker.on('error', (err: Error) => {
      finish(() => reject(err));
    });

    worker.on('exit', (code: number) => {
      if (code !== 0) {
        finish(() => reject(new Error(`probe worker exited with code ${code}`)));
      }
    });
  });
}
