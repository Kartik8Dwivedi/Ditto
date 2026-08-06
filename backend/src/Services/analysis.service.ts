import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';

import IndexerService from './indexer/indexer.service.js';
import PipelineService from './pipeline.service.js';
import TasksService from './tasks.service.js';
import QuotaService from './quota.service.js';
import PrService from './pr.service.js';
import { runLiveIndex, LIVE_MAX_FUNCTIONS, LIVE_CANDIDATE_CAP, describeLiveCaps } from './live-index.js';
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
 * analysed repos, charges the per-IP/day INDEX budget, and either enqueues a
 * Cloud Task or (locally) runs the job inline. `runJob()` is the paid worker
 * Cloud Tasks pushes to `/internal/run`; it drives the same pipeline the local
 * CLI uses, but CAPPED, updating the job's stage live so the frontend stepper can
 * follow along. A per-PR job (job.pr set) is delegated to PrService.runPrJob.
 *
 * See docs/ONDEMAND.md — the caps and the quota here are the abuse/cost safety,
 * non-negotiable.
 */

// Re-exported from live-index so existing importers (and tests) keep their path.
export { LIVE_MAX_FUNCTIONS, LIVE_CANDIDATE_CAP, describeLiveCaps };

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
  quotaService?: QuotaService;
  prService?: PrService;
}

const toJob = (doc: HydratedDocument<IJob>): Job => ({
  id: doc._id.toString(),
  status: doc.status,
  stage: doc.stage,
  repoId: doc.repoId ? doc.repoId.toString() : null,
  error: doc.error,
  functionsTotal: doc.functionsTotal,
  functionsAnalyzed: doc.functionsAnalyzed,
  // Present only on a per-PR job — lets the ONE poll endpoint drive both flows.
  ...(doc.pr ? { pr: doc.pr } : {}),
  prAnalysisId: doc.prAnalysisId ? doc.prAnalysisId.toString() : null,
});

class AnalysisService {
  private readonly jobRepository: JobRepository;
  private readonly repoRepository: RepoRepository;
  private readonly indexerService: IndexerService;
  private readonly pipelineService: PipelineService;
  private readonly tasksService: TasksService;
  private readonly quotaService: QuotaService;
  private readonly prService: PrService;

  constructor({
    jobRepository = new JobRepository(),
    repoRepository = new RepoRepository(),
    indexerService = new IndexerService(),
    pipelineService = new PipelineService(),
    tasksService = new TasksService(),
    quotaService = new QuotaService(),
    prService = new PrService(),
  }: AnalysisServiceDeps = {}) {
    this.jobRepository = jobRepository;
    this.repoRepository = repoRepository;
    this.indexerService = indexerService;
    this.pipelineService = pipelineService;
    this.tasksService = tasksService;
    this.quotaService = quotaService;
    this.prService = prService;
  }

  /**
   * Validate a pasted URL, dedup, charge the daily INDEX budget, and queue the
   * analysis. Returns immediately — the actual work happens in {@link runJob},
   * driven by Cloud Tasks (or inline locally). Never blocks on the pipeline.
   *
   * `ip` is the real client IP (req.ip, correct behind Cloud Run's proxy); it
   * keys the per-IP/day quota. The dedup hit is charged NOTHING — a repo we
   * already have is free.
   */
  async analyze(repoUrl: string, ip?: string): Promise<AnalyzeResult> {
    const { owner, name, ref } = parseGitHubUrl(repoUrl);

    // Dedup: a repo we already analysed is instant and free — no job, no spend,
    // and no quota charged.
    const existing = await this.repoRepository.findLatest(owner, name);
    if (existing) {
      logger.info(`dedup hit for ${owner}/${name} → repo ${existing._id.toString()}`);
      return { jobId: null, repoId: existing._id.toString() };
    }

    // A full index is the expensive path — charge the tight per-IP/day INDEX
    // budget. Throws a client-safe 429 when the day's budget is spent.
    await this.quotaService.consume(ip, 'index');

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
   * The worker. Cloud Tasks pushes every job — index AND per-PR — here. A per-PR
   * job (it carries a `pr` block) is delegated to PrService, which owns the
   * index-if-absent-then-check flow; everything else is an ordinary capped index.
   */
  async runJob(jobId: string): Promise<void> {
    const job = await this.jobRepository.findById(jobId);
    if (!job) {
      logger.error(`runJob: no job ${jobId}`);
      return;
    }

    // A per-PR job's worker lives in PrService (index the base repo, then check
    // the PR). Same job/poll machinery, different work.
    if (job.pr) {
      await this.prService.runPrJob(jobId);
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

      // Extract → hard-ceiling check → capped pipeline. The ceiling is a refusal,
      // not truncation, so a run that DOES complete always has analysed == total.
      const { repoId, functionsTotal: total } = await runLiveIndex({
        indexerService: this.indexerService,
        pipelineService: this.pipelineService,
        owner: job.owner,
        name: job.name,
        ref: job.ref,
        onStage,
        onExtracted: (n) => {
          functionsTotal = n;
        },
      });

      await this.jobRepository.markDone(jobId, {
        repoId: new Types.ObjectId(repoId),
        functionsAnalyzed: total,
        functionsTotal: total,
      });
      logger.success(`analysis job ${jobId} done in ${elapsed()} → repo ${repoId} (${total} functions)`);
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
