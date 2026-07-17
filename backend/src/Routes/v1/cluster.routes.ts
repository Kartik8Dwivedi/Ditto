import express from 'express';

import { ClusterController } from '../../Controllers/index.js';
import { asyncHandler, validate } from '../../Middlewares/index.js';
import { clusterIdSchema } from '../../Validators/cluster.validator.js';

const router = express.Router();

router
  .route('/:clusterId')
  .get(validate(clusterIdSchema), asyncHandler(ClusterController.getCluster));

export default router;
