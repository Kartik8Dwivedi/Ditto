import { describe, it, expect, vi } from 'vitest';

import AnalysisService, {
  LIVE_MAX_FUNCTIONS,
  LIVE_CANDIDATE_CAP,
  describeLiveCaps,
} from '../src/Services/analysis.service.js';

/**
 * The on-demand orchestrator. What matters and is asserted here:
 *   - dedup returns the existing repo and spends NOTHING (no job, no enqueue,
 *     and no quota charged),
 *   - the per-IP/day INDEX quota protects the key and blocks over budget,
 *   - runJob drives the CAPPED pipeline and records honest analysed/total counts,
 *   - an oversized repo is refused before any paid stage runs,
 *   - a per-PR job (job.pr set) is delegated to PrService.runPrJob.
 * The pipeline, indexer, quota and PrService are mocked — no LLM is ever reached.
 */

const REPO_ID = '6a5a506029d58c7241f1fd90';

const functionsOfLength = (n: number) => Array.from({ length: n }, (_v, i) => ({ name: `f${i}` }));

const makeService = (opts: {
  existingRepo?: unknown;
  tasksEnabled?: boolean;
  findById?: unknown;
  extract?: unknown;
  run?: unknown;
  /** When set, quotaService.consume rejects with this error (budget spent). */
  quotaError?: Error;
} = {}) => {
  const findLatest = vi.fn().mockResolvedValue(opts.existingRepo ?? null);
  const create = vi.fn().mockResolvedValue({ _id: { toString: () => 'job-1' } });
  const findById = vi.fn().mockResolvedValue(opts.findById ?? null);
  const markRunning = vi.fn().mockResolvedValue(undefined);
  const setStage = vi.fn().mockResolvedValue(undefined);
  const markDone = vi.fn().mockResolvedValue(undefined);
  const markFailed = vi.fn().mockResolvedValue(undefined);
  const extract = vi.fn().mockResolvedValue(opts.extract ?? { functions: [], commit: 'abc1234' });
  const run = vi.fn().mockResolvedValue(opts.run ?? { repoId: REPO_ID });
  const isEnabled = vi.fn().mockReturnValue(opts.tasksEnabled ?? true);
  const enqueueRun = vi.fn().mockResolvedValue(undefined);
  const consume = opts.quotaError
    ? vi.fn().mockRejectedValue(opts.quotaError)
    : vi.fn().mockResolvedValue(undefined);
  const runPrJob = vi.fn().mockResolvedValue(undefined);

  const mocks = {
    findLatest,
    create,
    findById,
    markRunning,
    setStage,
    markDone,
    markFailed,
    extract,
    run,
    isEnabled,
    enqueueRun,
    consume,
    runPrJob,
  };

  const service = new AnalysisService({
    jobRepository: {
      create,
      findById,
      markRunning,
      setStage,
      markDone,
      markFailed,
      findByIdOrFail: findById,
    } as never,
    repoRepository: { findLatest } as never,
    indexerService: { extract } as never,
    pipelineService: { run } as never,
    tasksService: { isEnabled, enqueueRun } as never,
    quotaService: { consume } as never,
    prService: { runPrJob } as never,
  });

  return { service, mocks };
};

describe('AnalysisService.analyze', () => {
  it('returns the existing repo on a dedup hit, creates NO job, and charges NO quota', async () => {
    const { service, mocks } = makeService({ existingRepo: { _id: { toString: () => REPO_ID } } });

    const result = await service.analyze('https://github.com/cline/cline', '1.2.3.4');

    expect(result).toEqual({ jobId: null, repoId: REPO_ID });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.enqueueRun).not.toHaveBeenCalled();
    // A repo we already have is free — the daily budget is not touched.
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('charges the per-IP/day INDEX budget, then queues and enqueues a new analysis', async () => {
    const { service, mocks } = makeService({ tasksEnabled: true });

    const result = await service.analyze('https://github.com/cline/cline', '1.2.3.4');

    expect(result).toEqual({ jobId: 'job-1', repoId: null });
    // Quota is charged with the real client IP against the INDEX bucket.
    expect(mocks.consume).toHaveBeenCalledWith('1.2.3.4', 'index');
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'cline', name: 'cline', status: 'queued' })
    );
    expect(mocks.enqueueRun).toHaveBeenCalledWith('job-1');
  });

  it('runs the job inline when Cloud Tasks is not configured', async () => {
    const { service, mocks } = makeService({ tasksEnabled: false });
    const runSpy = vi.spyOn(service, 'runJob').mockResolvedValue(undefined);

    const result = await service.analyze('https://github.com/cline/cline', '1.2.3.4');

    expect(result.jobId).toBe('job-1');
    expect(mocks.enqueueRun).not.toHaveBeenCalled();
    expect(runSpy).toHaveBeenCalledWith('job-1');
  });

  it('refuses when the per-IP/day INDEX budget is spent — before any job is created', async () => {
    const quotaError = new Error('Daily limit reached: you have used all 3 full repo analyses/indexes');
    const { service, mocks } = makeService({ quotaError });

    await expect(service.analyze('https://github.com/cline/cline', '9.9.9.9')).rejects.toThrow(
      /Daily limit reached/
    );
    // The quota was consulted, and no paid work was queued once it denied.
    expect(mocks.consume).toHaveBeenCalledWith('9.9.9.9', 'index');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.enqueueRun).not.toHaveBeenCalled();
  });

  it('rejects an invalid URL before touching the database or the quota', async () => {
    const { service, mocks } = makeService({});

    await expect(service.analyze('not a url')).rejects.toThrow();
    expect(mocks.findLatest).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});

describe('describeLiveCaps', () => {
  it('names the caps that are actually live, so a mode flip is verifiable in the logs', () => {
    const line = describeLiveCaps();
    expect(line).toContain(`maxFunctions=${LIVE_MAX_FUNCTIONS}`);
    expect(line).toContain(`candidateCap=${LIVE_CANDIDATE_CAP}`);
  });
});

describe('AnalysisService.runJob', () => {
  const job = { _id: { toString: () => 'job-1' }, owner: 'cline', name: 'cline', ref: null };

  it('drives the pipeline with the configured candidate cap and the true total', async () => {
    const { service, mocks } = makeService({
      findById: job,
      extract: { functions: functionsOfLength(120), commit: 'abc1234' },
      run: { repoId: REPO_ID },
    });

    await service.runJob('job-1');

    const runArgs = mocks.run.mock.calls[0][0];
    expect(runArgs).toMatchObject({
      owner: 'cline',
      name: 'cline',
      commit: 'abc1234',
      candidateCap: LIVE_CANDIDATE_CAP,
      functionsTotal: 120,
    });
    expect(runArgs.functions).toHaveLength(120);
    // Nothing is truncated on the live path — anything over the limit is
    // refused outright, so no maxFunctions cap is handed to the pipeline.
    expect(runArgs.maxFunctions).toBeUndefined();
    expect(mocks.markRunning).toHaveBeenCalledWith('job-1');
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it('reports analyzed == total on every successful run', async () => {
    const { service, mocks } = makeService({
      findById: job,
      extract: { functions: functionsOfLength(1337), commit: 'abc1234' },
    });

    await service.runJob('job-1');

    expect(mocks.markDone).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ functionsAnalyzed: 1337, functionsTotal: 1337 })
    );
  });

  it('refuses a repo above the live limit before any paid stage runs', async () => {
    const over = LIVE_MAX_FUNCTIONS + 1;
    const { service, mocks } = makeService({
      findById: job,
      extract: { functions: functionsOfLength(over), commit: 'abc1234' },
    });

    await service.runJob('job-1');

    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.markFailed).toHaveBeenCalledWith(
      'job-1',
      expect.stringContaining(`above the current live limit of ${LIVE_MAX_FUNCTIONS}`),
      over
    );
    expect(mocks.markDone).not.toHaveBeenCalled();
  });

  it('analyses a repo exactly at the limit', async () => {
    const { service, mocks } = makeService({
      findById: job,
      extract: { functions: functionsOfLength(LIVE_MAX_FUNCTIONS), commit: 'abc1234' },
    });

    await service.runJob('job-1');

    expect(mocks.run).toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it('marks the job failed with a safe message when the pipeline throws', async () => {
    const { service, mocks } = makeService({
      findById: job,
      extract: { functions: functionsOfLength(10), commit: 'abc1234' },
    });
    mocks.run.mockRejectedValue(new Error('boom'));

    await service.runJob('job-1');

    expect(mocks.markFailed).toHaveBeenCalledWith(
      'job-1',
      expect.stringMatching(/failed unexpectedly/i),
      10
    );
  });

  it('delegates a per-PR job (job.pr set) to PrService.runPrJob and runs no index', async () => {
    const prJob = { ...job, pr: { prNumber: 7, headSha: 'h', baseSha: 'b', headRef: 'f' } };
    const { service, mocks } = makeService({ findById: prJob });

    await service.runJob('job-1');

    expect(mocks.runPrJob).toHaveBeenCalledWith('job-1');
    // The ordinary index worker must not run for a PR job.
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.markDone).not.toHaveBeenCalled();
  });
});
