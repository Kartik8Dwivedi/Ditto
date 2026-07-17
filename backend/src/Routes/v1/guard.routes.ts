import express from 'express';

import { GuardController } from '../../Controllers/index.js';
import { asyncHandler, validate } from '../../Middlewares/index.js';
import { guardCheckSchema } from '../../Validators/guard.validator.js';

const router = express.Router();

router.route('/check').post(validate(guardCheckSchema), asyncHandler(GuardController.checkGuard));

export default router;
