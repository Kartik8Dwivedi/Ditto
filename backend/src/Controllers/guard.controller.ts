import type { Request, Response } from 'express';

import { GuardService } from '../Services/index.js';
import { sendSuccess } from '../Utils/index.js';
import type { GuardCheckBody } from '../Validators/guard.validator.js';

// Lazy singleton: instantiated on first request, not at module load,
// so importing app.js never crashes when OPENAI_API_KEY or MONGO_URI is absent.(same behaviour as the previous eager
// singleton, just deferred).
let guardService: GuardService | null = null;

/** The PR check: are you about to reinvent something this repo already knows? */
export const checkGuard = async (req: Request, res: Response): Promise<void> => {
  guardService ??= new GuardService();
  const { owner, name, functions } = req.body as GuardCheckBody;
  const result = await guardService.check({ owner, name, functions });
  sendSuccess(res, { data: result, message: 'Guard check complete' });
};
