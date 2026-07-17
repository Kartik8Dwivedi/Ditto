import express from 'express';

import resourceRoutes from './resource.routes.js';
import repoRoutes from './repo.routes.js';
import clusterRoutes from './cluster.routes.js';
import guardRoutes from './guard.routes.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({ success: true, message: 'API v1 is up', data: null });
});

router.use('/resources', resourceRoutes);
router.use('/repos', repoRoutes);
router.use('/clusters', clusterRoutes);
router.use('/guard', guardRoutes);

export default router;
