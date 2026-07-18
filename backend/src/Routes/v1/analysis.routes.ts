import express from 'express';

import { AnalysisController } from '../../Controllers/index.js';
import { asyncHandler, validate, requireTaskSecret } from '../../Middlewares/index.js';
import { analyzeSchema, internalRunSchema, jobIdSchema } from '../../Validators/analysis.validator.js';

/**
 * On-demand analysis routes (docs/ONDEMAND.md). Mounted at the v1 root so the
 * paths are /api/v1/analyze, /api/v1/internal/run, /api/v1/jobs/:jobId.
 */
const router = express.Router();

router.route('/analyze').post(validate(analyzeSchema), asyncHandler(AnalysisController.analyze));

// Cloud Tasks only — the secret guard runs BEFORE validation so an unauthorised
// caller learns nothing about the expected body.
router
  .route('/internal/run')
  .post(requireTaskSecret, validate(internalRunSchema), asyncHandler(AnalysisController.runInternal));

router.route('/jobs/:jobId').get(validate(jobIdSchema), asyncHandler(AnalysisController.getJob));

export default router;
