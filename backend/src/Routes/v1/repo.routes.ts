import express from 'express';

import { RepoController } from '../../Controllers/index.js';
import { asyncHandler, validate } from '../../Middlewares/index.js';
import { repoIdSchema } from '../../Validators/repo.validator.js';

const router = express.Router();

router.route('/').get(asyncHandler(RepoController.listRepos));

router.route('/:repoId').get(validate(repoIdSchema), asyncHandler(RepoController.getRepo));

export default router;
