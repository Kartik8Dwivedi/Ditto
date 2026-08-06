import type { Request, Response } from 'express';

import { AnalysisService } from '../Services/index.js';
import { sendSuccess } from '../Utils/index.js';
import type { AnalyzeBody, InternalRunBody, JobIdParams } from '../Validators/analysis.validator.js';

/**
 * On-demand analysis endpoints (docs/ONDEMAND.md).
 *
 * Thin HTTP adapters: validated input in, service call, standard envelope out.
 * No try/catch — asyncHandler forwards rejections to the error middleware.
 */
const analysisService = new AnalysisService();

/** Paste-a-URL entry point: validate, dedup, queue. Returns fast, never blocks. */
export const analyze = async (req: Request, res: Response): Promise<void> => {
  const { repoUrl } = req.body as AnalyzeBody;
  // req.ip is the REAL client IP behind Cloud Run (app.ts sets trust proxy=1);
  // it keys the per-IP/day INDEX budget.
  const result = await analysisService.analyze(repoUrl, req.ip);
  sendSuccess(res, {
    data: result,
    message: result.repoId ? 'Repo already analysed' : 'Analysis queued',
  });
};

/**
 * Cloud Tasks target — protected by requireTaskSecret. Runs the capped pipeline
 * to completion, then reports ok so the queue does not retry a finished job.
 */
export const runInternal = async (req: Request, res: Response): Promise<void> => {
  const { jobId } = req.body as InternalRunBody;
  await analysisService.runJob(jobId);
  sendSuccess(res, { data: { ok: true }, message: 'Job processed' });
};

/** The polled status the frontend stepper reads every couple of seconds. */
export const getJob = async (req: Request, res: Response): Promise<void> => {
  const { jobId } = req.params as unknown as JobIdParams;
  const job = await analysisService.getJob(jobId);
  sendSuccess(res, { data: job, message: 'Job fetched' });
};
