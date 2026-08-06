import express from 'express';

import repoRoutes from './repo.routes.js';
import clusterRoutes from './cluster.routes.js';
import guardRoutes from './guard.routes.js';
import analysisRoutes from './analysis.routes.js';
import prRoutes from './pr.routes.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({ success: true, message: 'API v1 is up', data: null });
});

router.use('/repos', repoRoutes);
router.use('/clusters', clusterRoutes);
router.use('/guard', guardRoutes);
router.use('/pr', prRoutes);
// On-demand analysis lives at the v1 root: /analyze, /internal/run, /jobs/:id.
router.use('/', analysisRoutes);

export default router;
