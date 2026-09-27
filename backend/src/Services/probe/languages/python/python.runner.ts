import { readFileSync } from 'node:fs';
import {
  MAX_DISPLAY_CHARS,
  PROBE_TIMEOUT_MS,
  type LanguageProbeRunner,
  type ProbeMember,
  type WorkerResult,
} from '../../contracts.js';
import { executeSandboxedWorker } from '../../shared/worker-harness.js';
import { resolveProbeFile } from '../../shared/worker-paths.js';
import AppConfig from '../../../../Config/AppConfig.js';

let cachedHarness: string | null = null;

function loadHarness(): string {
  if (!cachedHarness) {
    const harnessPath = resolveProbeFile(import.meta.url, 'harness.py');
    cachedHarness = readFileSync(harnessPath, 'utf-8');
  }
  return cachedHarness;
}

export class PythonProbeRunner implements LanguageProbeRunner {
  public async run(members: ProbeMember[], inputs: string[]): Promise<WorkerResult> {
    const workerPath = resolveProbeFile(import.meta.url, 'python.worker.js');
    const harnessSource = loadHarness();

    return executeSandboxedWorker({
      workerPath,
      workerData: {
        harnessSource,
        timeoutMs: PROBE_TIMEOUT_MS,
        members: members.map((m) => ({
          id: m.id,
          body: m.body,
          preamble: m.preamble,
        })),
        inputs,
        maxDisplayChars: MAX_DISPLAY_CHARS,
        interruptBuffer: new Int32Array(new SharedArrayBuffer(4))
      },
      memberCount: members.length,
      inputCount: inputs.length,
      options: {
        // Worker spawns in a fresh V8 context, so it doesn't inherit
        // the parent's tsx hook - only matters in dev since workerPath
        // is already compiled .js in prod.
        execArgv: AppConfig.IS_PRODUCTION ? [] : ['--import', 'tsx'],
      },
    });
  }
}
