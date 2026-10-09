import type { Request, Response } from 'express';

import { IntelligenceService } from '../Services/index.js';
import { sendSuccess } from '../Utils/index.js';
import type { ClusterIdParams } from '../Validators/cluster.validator.js';

let intelligenceService: IntelligenceService | null = null;

/** One cluster: member bodies side by side, plus the divergence table. */
export const getCluster = async (req: Request, res: Response): Promise<void> => {
  intelligenceService ??= new IntelligenceService();
  const { clusterId } = req.params as unknown as ClusterIdParams;
  const detail = await intelligenceService.getClusterDetail(clusterId);
  sendSuccess(res, { data: detail, message: 'Cluster fetched' });
};
