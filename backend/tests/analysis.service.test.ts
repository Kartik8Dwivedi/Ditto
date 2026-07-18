import { describe, it, expect, vi } from 'vitest';

import AnalysisService, {
  LIVE_MAX_FUNCTIONS,
  LIVE_CANDIDATE_CAP,
  LIVE_ANALYSIS_CAP,
  describeLiveCaps,
} from '../src/Services/analysis.service.js';

/**
 * The on-demand orchestrator. What matters and is asserted here:
 *   - dedup returns the existing repo and spends NOTHING (no job, no enqueue),
 *   - the global cap protects the key,
 *   - runJob drives the CAPPED pipeline (250 fns / 20 candidates) and records
 *     honest analysed/total counts,
 *   - an oversized repo is refused before any paid stage runs.
 * The pipeline and indexer are mocked — no LLM is ever reached.
 */

const REPO_ID = '6a5a506029d58c7241f1fd90';

const functionsOfLength = (n: number) => Array.from({ length: n }, (_v, i) => ({ name: `f${i}` }));

const makeService = (opts: {
  existingRepo?: unknown;
  tasksEnabled?: boolean;
  jobCount?: number;
  findById?: unknown;
  extract?: unknown;
  run?: unknown;
} = {}) => {
  const findLatest = vi.fn().mockResolvedValue(opts.existingRepo ?? null);
  const count = vi.fn().mockResolvedValue(opts.jobCount ?? 0);
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

  const mocks = {
    findLatest,
    count,
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
  };

  const service = new AnalysisService({
    jobRepository: {
      count,
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
  });

  return { service, mocks };
};

describe('AnalysisService.analyze', () => {
  it('returns the existing repo on a dedup hit and creates NO job', async () => {
    const { service, mocks } = makeService({ existingRepo: { _id: { toString: () => REPO_ID } } });

    const result = await service.analyze('https://github.com/cline/cline');

    expect(result).toEqual({ jobId: null, repoId: REPO_ID });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.enqueueRun).not.toHaveBeenCalled();
  });

  it('queues a new analysis and enqueues a task when none exists', async () => {
    const { service, mocks } = makeService({ tasksEnabled: true });

    const result = await service.analyze('https://github.com/cline/cline');

    expect(result).toEqual({ jobId: 'job-1', repoId: null });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'cline', name: 'cline', status: 'queued' })
    );
    expect(mocks.enqueueRun).toHaveBeenCalledWith('job-1');
  });

  it('runs the job inline when Cloud Tasks is not configured', async () => {
    const { service, mocks } = makeService({ tasksEnabled: false });
    const runSpy = vi.spyOn(service, 'runJob').mockResolvedValue(undefined);

    const result = await service.analyze('https://github.com/cline/cline');

    expect(result.jobId).toBe('job-1');
    expect(mocks.enqueueRun).not.toHaveBeenCalled();
    expect(runSpy).toHaveBeenCalledWith('job-1');
  });

  it('refuses once the global live-analysis cap is reached', async () => {
    const { service, mocks } = makeService({ jobCount: LIVE_ANALYSIS_CAP });

    await expect(service.analyze('https://github.com/cline/cline')).rejects.toThrow(/capacity/i);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid URL before touching the database', async () => {
    const { service, mocks } = makeService({});

    await expect(service.analyze('not a url')).rejects.toThrow();
    expect(mocks.findLatest).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
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
});
