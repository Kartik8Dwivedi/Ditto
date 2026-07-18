import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';

import IndexerService from './indexer/indexer.service.js';
import PipelineService from './pipeline.service.js';
import TasksService from './tasks.service.js';
import { JobRepository, RepoRepository } from '../Repository/index.js';
import { parseGitHubUrl } from '../Validators/analysis.validator.js';
import AppConfig from '../Config/AppConfig.js';
import logger from '../Config/logger.js';
import AppError from '../Utils/errors/AppError.js';
import type { Job, IJob, StageReporter } from '../Models/index.js';
import type { HydratedDocument } from 'mongoose';

/**
 * On-demand analysis — the live "paste a URL, watch it analyse" path.
 *
 * `analyze()` is fast and cheap: it validates, deduplicates against already
 * analysed repos, and either enqueues a Cloud Task or (locally) runs the job
 * inline. `runJob()` is the paid worker Cloud Tasks pushes to `/internal/run`;
 * it drives the same pipeline the local CLI uses, but CAPPED, updating the job's
 * stage live so the frontend stepper can follow along.
 *
 * See docs/ONDEMAND.md — the caps here are the abuse/cost safety, non-negotiable.
 */

/**
 * The live caps, read from the environment so TEST mode (2000/100) and JUDGING
 * mode (300/20) are an env edit + redeploy apart — never a code change. See
 * AppConfig and docs/ONDEMAND.md. The offline CLI pipeline ignores these.
 */
export const LIVE_MAX_FUNCTIONS = AppConfig.LIVE_MAX_FUNCTIONS;
export const LIVE_CANDIDATE_CAP = AppConfig.LIVE_CANDIDATE_CAP;
/** Total live analyses allowed for the whole event — protects the key. */
export const LIVE_ANALYSIS_CAP = 20;

/** One line naming the mode that is actually live, for the Cloud Run logs. */
export const describeLiveCaps = (): string =>
  `live caps: maxFunctions=${LIVE_MAX_FUNCTIONS} candidateCap=${LIVE_CANDIDATE_CAP} ` +
  `deadline=${Math.round(AppConfig.LIVE_DEADLINE_MS / 1000)}s`;

export interface AnalyzeResult {
  /** Set when a new analysis was queued. */
  jobId: string | null;
  /** Set on a DEDUP hit — the repo is already analysed, navigate now. */
  repoId: string | null;
}

interface AnalysisServiceDeps {
  jobRepository?: JobRepository;
  repoRepository?: RepoRepository;
  indexerService?: IndexerService;
  pipelineService?: PipelineService;
  tasksService?: TasksService;
}

const toJob = (doc: HydratedDocument<IJob>): Job => ({
  id: doc._id.toString(),
  status: doc.status,
  stage: doc.stage,
  repoId: doc.repoId ? doc.repoId.toString() : null,
  error: doc.error,
  functionsTotal: doc.functionsTotal,
  functionsAnalyzed: doc.functionsAnalyzed,
});

class AnalysisService {
  private readonly jobRepository: JobRepository;
  private readonly repoRepository: RepoRepository;
  private readonly indexerService: IndexerService;
  private readonly pipelineService: PipelineService;
  private readonly tasksService: TasksService;

  constructor({
    jobRepository = new JobRepository(),
    repoRepository = new RepoRepository(),
    indexerService = new IndexerService(),
    pipelineService = new PipelineService(),
    tasksService = new TasksService(),
  }: AnalysisServiceDeps = {}) {
    this.jobRepository = jobRepository;
    this.repoRepository = repoRepository;
    this.indexerService = indexerService;
    this.pipelineService = pipelineService;
    this.tasksService = tasksService;
  }

  /**
   * Validate a pasted URL, dedup, and queue the analysis. Returns immediately —
   * the actual work happens in {@link runJob}, driven by Cloud Tasks (or inline
   * locally). Never blocks on the pipeline.
   */
  async analyze(repoUrl: string): Promise<AnalyzeResult> {
    const { owner, name, ref } = parseGitHubUrl(repoUrl);

    // Dedup: a repo we already analysed is instant and free — no job, no spend.
    const existing = await this.repoRepository.findLatest(owner, name);
    if (existing) {
      logger.info(`dedup hit for ${owner}/${name} → repo ${existing._id.toString()}`);
      return { jobId: null, repoId: existing._id.toString() };
    }

    // Global guard: every job is one paid run, so the job count IS the spend
    // count. Refuse politely once the event budget is reached.
    const used = await this.jobRepository.count();
    if (used >= LIVE_ANALYSIS_CAP) {
      throw new AppError(
        'Live analysis is at capacity for the event — explore the pre-analysed repos.',
        StatusCodes.TOO_MANY_REQUESTS
      );
    }

    const job = await this.jobRepository.create({
      owner,
      name,
      ref: ref ?? null,
      status: 'queued',
      stage: 'queued',
    });
    const jobId = job._id.toString();

    if (this.tasksService.isEnabled()) {
      await this.tasksService.enqueueRun(jobId);
    } else {
      // Local fallback: no Cloud Tasks configured, so run the job in-process.
      // Fire-and-forget — analyze() must still return the jobId immediately.
      logger.warn(`Cloud Tasks not configured — running job ${jobId} inline (local fallback)`);
      void this.runJob(jobId);
    }

    return { jobId, repoId: null };
  }

  /**
   * The worker. Runs the CAPPED pipeline for one job, advancing `job.stage` at
   * every boundary and recording the outcome. Never throws: a failed run is a
   * `failed` job with a human-readable reason, so Cloud Tasks sees success and
   * does not retry (which would re-spend on a job that deterministically fails).
   */
  async runJob(jobId: string): Promise<void> {
    const job = await this.jobRepository.findById(jobId);
    if (!job) {
      logger.error(`runJob: no job ${jobId}`);
      return;
    }

    // Every live run states the mode it is running under, so the Cloud Run logs
    // answer "which caps are actually live?" without guessing at the env.
    logger.info(`job ${jobId} (${job.owner}/${job.name}) starting — ${describeLiveCaps()}`);

    const startedAt = Date.now();
    const elapsedMs = (): number => Date.now() - startedAt;
    const elapsed = (): string => `${(elapsedMs() / 1000).toFixed(1)}s`;

    let functionsTotal: number | undefined;
    try {
      await this.jobRepository.markRunning(jobId);

      /**
       * Stage boundaries do three things: advance the job the frontend polls,
       * log elapsed time so we can measure our margin against Cloud Run's 1200s
       * request timeout on a real run, and enforce our own earlier deadline.
       */
      const onStage: StageReporter = async (stage) => {
        logger.info(`job ${jobId} [t+${elapsed()}] → ${stage}`);
        if (elapsedMs() > AppConfig.LIVE_DEADLINE_MS) {
          throw new AppError(
            `Analysis exceeded the ${Math.round(AppConfig.LIVE_DEADLINE_MS / 1000)}s live time budget ` +
              `at the "${stage}" stage. Try a smaller repo.`,
            StatusCodes.REQUEST_TIMEOUT
          );
        }
        await this.jobRepository.setStage(jobId, stage);
      };

      const extracted = await this.indexerService.extract({
        owner: job.owner,
        name: job.name,
        branch: job.ref ?? undefined,
        onStage,
      });
      functionsTotal = extracted.functions.length;

      // HARD CEILING, not truncation. Dropping functions to fit a cap makes
      // clusters silently vanish, and a repo that is half-analysed then reads as
      // clean — worse than an honest refusal. So we refuse, before spending
      // anything, and a run that DOES complete always has analysed == total.
      if (functionsTotal > LIVE_MAX_FUNCTIONS) {
        throw new AppError(
          `This repo has ${functionsTotal} functions, above the current live limit of ` +
            `${LIVE_MAX_FUNCTIONS} — try a smaller repo.`,
          StatusCodes.UNPROCESSABLE_ENTITY
        );
      }

      const report = await this.pipelineService.run({
        owner: job.owner,
        name: job.name,
        functions: extracted.functions,
        commit: extracted.commit,
        candidateCap: LIVE_CANDIDATE_CAP,
        functionsTotal,
        onStage,
      });

      // No cap was applied (anything over the limit was refused above), so the
      // analysed count IS the total — the frontend shows no truncation note.
      await this.jobRepository.markDone(jobId, {
        repoId: new Types.ObjectId(report.repoId),
        functionsAnalyzed: functionsTotal,
        functionsTotal,
      });
      logger.success(
        `analysis job ${jobId} done in ${elapsed()} → repo ${report.repoId} ` +
          `(${functionsTotal} functions, ${report.candidateClusters} candidates)`
      );
    } catch (err) {
      // An AppError carries a client-safe message; anything else is masked.
      const message =
        err instanceof AppError
          ? err.message
          : 'Analysis failed unexpectedly. Please try another repo.';
      logger.error(
        `analysis job ${jobId} failed after ${elapsed()}: ${err instanceof Error ? err.message : err}`
      );
      await this.jobRepository.markFailed(jobId, message, functionsTotal);
    }
  }

  /** The polled status payload for GET /jobs/:jobId. */
  async getJob(jobId: string): Promise<Job> {
    const job = await this.jobRepository.findByIdOrFail(jobId);
    return toJob(job);
  }
}

export default AnalysisService;
