import express from 'express';

import { PrController } from '../../Controllers/index.js';
import { asyncHandler, validate } from '../../Middlewares/index.js';
import { createPrSchema, prIdSchema } from '../../Validators/pr.validator.js';

/** Per-PR analysis routes: POST /api/v1/pr, GET /api/v1/pr/:id. */
const router = express.Router();

router.route('/').post(validate(createPrSchema), asyncHandler(PrController.createPr));
router.route('/:id').get(validate(prIdSchema), asyncHandler(PrController.getPr));

export default router;
