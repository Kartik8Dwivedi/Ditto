import type { HydratedDocument, Types } from 'mongoose';

import CrudRepository from './crud.repository.js';
import { JobModel, type IJob, type JobStage } from '../Models/index.js';

/** Repository for on-demand analysis jobs. */
class JobRepository extends CrudRepository<IJob> {
  constructor() {
    super(JobModel);
  }

  /**
   * How many analysis jobs exist in total. This is the global live-analysis
   * counter that protects the OpenAI key during the event: every job is one
   * paid run (dedup hits never create a job), so the row count IS the spend
   * count, and no separate counter can drift out of sync with it.
   */
  async count(): Promise<number> {
    return this.model.countDocuments().exec();
  }

  /** Advance the live stage the frontend stepper renders. */
  async setStage(id: string, stage: JobStage): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { stage } }).exec();
  }

  /** Mark the job as picked up by the worker. */
  async markRunning(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { status: 'running', stage: 'fetch' } }).exec();
  }

  /** Mark a successful run — the repo to navigate to and the honest counts. */
  async markDone(
    id: string,
    result: { repoId: Types.ObjectId; functionsAnalyzed: number; functionsTotal: number }
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: id },
        {
          $set: {
            status: 'done',
            stage: 'done',
            error: null,
            repoId: result.repoId,
            functionsAnalyzed: result.functionsAnalyzed,
            functionsTotal: result.functionsTotal,
          },
        }
      )
      .exec();
  }

  /** Mark a failed run with a client-safe reason. `functionsTotal` may already
   * be known (e.g. the repo was too large) — pass it so the UI can explain. */
  async markFailed(id: string, error: string, functionsTotal?: number): Promise<void> {
    await this.model
      .updateOne(
        { _id: id },
        {
          $set: {
            status: 'failed',
            error,
            ...(functionsTotal !== undefined ? { functionsTotal } : {}),
          },
        }
      )
      .exec();
  }
}

export type JobDocument = HydratedDocument<IJob>;

export default JobRepository;
