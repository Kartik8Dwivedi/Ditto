import express from 'express';

import { ResourceController } from '../../Controllers/index.js';
import { asyncHandler, validate } from '../../Middlewares/index.js';
import {
  createResourceSchema,
  updateResourceSchema,
  resourceIdSchema,
  listResourceSchema,
} from '../../Validators/resource.validator.js';

const router = express.Router();

router
  .route('/')
  .get(validate(listResourceSchema), asyncHandler(ResourceController.listResources))
  .post(validate(createResourceSchema), asyncHandler(ResourceController.createResource));

router
  .route('/:id')
  .get(validate(resourceIdSchema), asyncHandler(ResourceController.getResource))
  .patch(validate(updateResourceSchema), asyncHandler(ResourceController.updateResource))
  .delete(validate(resourceIdSchema), asyncHandler(ResourceController.deleteResource));

export default router;
