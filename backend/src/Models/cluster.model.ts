import mongoose from 'mongoose';
import type { Types } from 'mongoose';

import type { DisagreementRisk, DivergenceTable } from './contracts.js';

/**
 * A group of functions the flagship model has judged to be behaviourally
 * equivalent, plus — when the members are pure enough to run — the executed
 * proof of whether they actually agree.
 */
export interface ICluster {
  repoId: Types.ObjectId;
  functionIds: Types.ObjectId[];
  canonicalId: Types.ObjectId;
  sameBehavior: boolean;
  behaviorSummary: string;
  domain: string;
  differences: string[];
  disagreementRisk: DisagreementRisk;
  confidence: number;
  /** Mean pairwise cosine similarity of the members — why they were grouped. */
  cohesion: number;
  /** JSON-encoded arg arrays, e.g. '["00919876543210"]'. */
  probeInputs: string[];
  divergence?: DivergenceTable;
  createdAt: Date;
  updatedAt: Date;
}

const divergenceResultSchema = new mongoose.Schema(
  {
    functionId: { type: String, required: true },
    // output XOR error. A result that THREW carries an error and an empty
    // output — and Mongoose treats '' as "missing" for a `required` String, so
    // `required: true` here silently failed validation on every throwing result
    // and aborted the whole cluster save. Both are optional; the invariant that
    // one is present is a path validator (which runs under validateSync too,
    // unlike a pre-validate hook).
    output: {
      type: String,
      default: '',
      validate: {
        validator(this: { output?: string; error?: string }): boolean {
          const hasOutput = typeof this.output === 'string' && this.output.length > 0;
          const hasError = typeof this.error === 'string' && this.error.length > 0;
          return hasOutput || hasError;
        },
        message: 'a divergence result must have an output or an error',
      },
    },
    error: { type: String },
  },
  { _id: false }
);

const divergenceRowSchema = new mongoose.Schema(
  {
    input: { type: String, required: true },
    results: { type: [divergenceResultSchema], default: [] },
    diverged: { type: Boolean, required: true },
  },
  { _id: false }
);

const divergenceSchema = new mongoose.Schema<DivergenceTable>(
  {
    // Never defaults to true. It is set by the prober, and only after real code
    // has really run.
    executed: { type: Boolean, required: true, default: false },
    rows: { type: [divergenceRowSchema], default: [] },
  },
  { _id: false }
);

const clusterSchema = new mongoose.Schema<ICluster>(
  {
    repoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repo', required: true, index: true },
    functionIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Function' }],
      default: [],
    },
    canonicalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Function', required: true },
    sameBehavior: { type: Boolean, required: true },
    behaviorSummary: { type: String, default: '' },
    domain: { type: String, default: 'unknown' },
    differences: { type: [String], default: [] },
    disagreementRisk: {
      type: String,
      enum: ['none', 'cosmetic', 'semantic'],
      default: 'none',
    },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    cohesion: { type: Number, default: 0 },
    probeInputs: { type: [String], default: [] },
    divergence: { type: divergenceSchema, default: undefined },
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

const ClusterModel = mongoose.model<ICluster>('Cluster', clusterSchema);

export default ClusterModel;
