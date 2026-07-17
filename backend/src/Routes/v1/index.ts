import express from 'express';

import resourceRoutes from './resource.routes.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({ success: true, message: 'API v1 is up', data: null });
});

router.use('/resources', resourceRoutes);

export default router;
