import { StatusCodes } from 'http-status-codes';
import type { Request, Response } from 'express';

import { PrService } from '../Services/index.js';
import { sendSuccess } from '../Utils/index.js';
import { parsePrInput, type CreatePrBody, type PrIdParams } from '../Validators/pr.validator.js';

/**
 * Per-PR analysis endpoints. Thin HTTP adapters over PrService — no try/catch,
 * asyncHandler forwards rejections to the error middleware.
 */
const prService = new PrService();

/**
 * POST /api/v1/pr — analyse a pull request against its already-indexed repo.
 *
 * Returns `{ prAnalysisId }` (results ready — a dedup hit or the synchronous
 * run's output) plus the `jobId` of the pollable job, so the existing
 * job→poll→results machinery drives the frontend unchanged.
 */
export const createPr = async (req: Request, res: Response): Promise<void> => {
  const input = parsePrInput(req.body as CreatePrBody);
  // req.ip is the REAL client IP behind Cloud Run (app.ts sets trust proxy=1);
  // it keys the per-IP/day spend budget.
  const result = await prService.submit(input, req.ip);
  sendSuccess(res, {
    statusCode: StatusCodes.ACCEPTED,
    data: result,
    message: result.jobId ? 'PR analysis submitted' : 'PR already analysed',
  });
};

/** GET /api/v1/pr/:id — fetch a finished PR analysis. */
export const getPr = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as unknown as PrIdParams;
  const analysis = await prService.getAnalysis(id);
  sendSuccess(res, { data: analysis, message: 'PR analysis fetched' });
};
