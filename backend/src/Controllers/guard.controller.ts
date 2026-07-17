import type { Request, Response } from 'express';

import { GuardService } from '../Services/index.js';
import { sendSuccess } from '../Utils/index.js';
import type { GuardCheckBody } from '../Validators/guard.validator.js';

const guardService = new GuardService();

/** The PR check: are you about to reinvent something this repo already knows? */
export const checkGuard = async (req: Request, res: Response): Promise<void> => {
  const { owner, name, functions } = req.body as GuardCheckBody;
  const result = await guardService.check({ owner, name, functions });
  sendSuccess(res, { data: result, message: 'Guard check complete' });
};
