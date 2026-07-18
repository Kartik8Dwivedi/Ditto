import mongoose from 'mongoose';
import type { Types } from 'mongoose';

import type { JobStatus, JobStage } from './contracts.js';

/**
 * One on-demand analysis request — a judge pasted a URL, we queued a run.
 *
 * The job is the live-progress record the frontend polls: `stage` advances
 * through the pipeline so the stepper lights up, and `repoId` is filled in when
 * the run completes so the browser knows where to navigate. It is intentionally
 * separate from the `repos`/`clusters` results the pipeline writes — a job is
 * transient status, those are the durable analysis.
 */
export interface IJob {
  owner: string;
  name: string;
  /** Branch/tag pasted in the URL, or null for the repo's default branch. */
  ref: string | null;
  status: JobStatus;
  stage: JobStage | null;
  /** The analysed repo snapshot — set only when the run succeeds. */
  repoId: Types.ObjectId | null;
  /** Human-readable failure reason — set only when the run fails. */
  error: string | null;
  /** Functions the AST index found, before any cap. */
  functionsTotal: number | null;
  /** Functions actually analysed — may be capped below the total. */
  functionsAnalyzed: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new mongoose.Schema<IJob>(
  {
    owner: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    ref: { type: String, default: null },
    status: {
      type: String,
      enum: ['queued', 'running', 'done', 'failed'],
      required: true,
      default: 'queued',
    },
    stage: {
      type: String,
      enum: ['queued', 'fetch', 'parse', 'fingerprint', 'embed', 'cluster', 'adjudicate', 'probe', 'done'],
      default: 'queued',
    },
    repoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repo', default: null },
    error: { type: String, default: null },
    functionsTotal: { type: Number, default: null },
    functionsAnalyzed: { type: Number, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

const JobModel = mongoose.model<IJob>('Job', jobSchema);

export default JobModel;
