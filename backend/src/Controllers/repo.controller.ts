import type { Request, Response } from 'express';

import { IntelligenceService } from '../Services/index.js';
import { sendSuccess } from '../Utils/index.js';
import type { RepoIdParams } from '../Validators/repo.validator.js';

/**
 * Repo endpoints — the Intelligence Map's data source.
 *
 * Stateless HTTP adapters: read validated input, call the service, shape the
 * response. No try/catch — asyncHandler forwards rejections to the error
 * middleware.
 */
const intelligenceService = new IntelligenceService();

export const listRepos = async (_req: Request, res: Response): Promise<void> => {
  const repos = await intelligenceService.listRepos();
  sendSuccess(res, { data: repos, message: 'Repos fetched' });
};

export const getRepo = async (req: Request, res: Response): Promise<void> => {
  const { repoId } = req.params as unknown as RepoIdParams;
  const detail = await intelligenceService.getRepoDetail(repoId);
  sendSuccess(res, { data: detail, message: 'Repo fetched' });
};
