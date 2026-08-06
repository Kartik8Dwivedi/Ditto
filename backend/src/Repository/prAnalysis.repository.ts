import type { HydratedDocument } from 'mongoose';

import CrudRepository from './crud.repository.js';
import { PrAnalysisModel, type IPrAnalysis } from '../Models/index.js';

/** Repository for finished per-PR analyses. */
class PrAnalysisRepository extends CrudRepository<IPrAnalysis> {
  constructor() {
    super(PrAnalysisModel);
  }

  /**
   * The dedup lookup. A head commit uniquely identifies the code a PR proposes,
   * so a stored analysis for that SHA is the answer to a re-check — no re-spend.
   */
  async findByHeadSha(headSha: string): Promise<HydratedDocument<IPrAnalysis> | null> {
    return this.model.findOne({ headSha }).exec();
  }
}

export default PrAnalysisRepository;
