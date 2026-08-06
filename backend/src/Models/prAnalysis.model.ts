import mongoose from 'mongoose';

import type { PrFinding, DivergenceTable, PrFunctionRef } from './contracts.js';

/**
 * A finished per-PR analysis — SELF-CONTAINED on purpose.
 *
 * The findings (and their executed divergence tables) are embedded inline rather
 * than referencing Function documents. This keeps the PR's changed functions OUT
 * of the paid repo index (`replaceForRepo` would wipe it) and sidesteps the
 * ObjectId-ref problem entirely: a PR analysis is a leaf document you fetch whole.
 *
 * `headSha` is the dedup key: a re-check of the same head commit returns the
 * stored analysis for ₹0 instead of re-spending on the same work.
 */
export interface IPrAnalysis {
  owner: string;
  name: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  prUrl: string;
  /** Count kept after the diff-range filter. */
  changedFunctions: number;
  /** One finding per changed function, embedded inline. */
  findings: PrFinding[];
  createdAt: Date;
  updatedAt: Date;
}

/** A repo-relative code location shown against a finding. */
const prFunctionRefSchema = new mongoose.Schema<PrFunctionRef>(
  {
    name: { type: String, required: true },
    file: { type: String, required: true },
    startLine: { type: Number, required: true },
    endLine: { type: Number, required: true },
  },
  { _id: false }
);

/**
 * The executed divergence table — same shape and the same output-XOR-error
 * validator as the cluster model, so a result that THREW (empty output, set
 * error) never fails validation and aborts the save.
 */
const divergenceResultSchema = new mongoose.Schema(
  {
    functionId: { type: String, required: true },
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
    executed: { type: Boolean, required: true, default: false },
    rows: { type: [divergenceRowSchema], default: [] },
  },
  { _id: false }
);

const prFindingSchema = new mongoose.Schema<PrFinding>(
  {
    newFunction: { type: prFunctionRefSchema, required: true },
    // Nullable: absent on a novel finding. Stored as null so the API shape (§3.4)
    // round-trips exactly.
    match: { type: prFunctionRefSchema, default: null },
    verdict: { type: String, enum: ['duplicate', 'near-duplicate', 'novel'], required: true },
    similarity: { type: Number, default: 0 },
    confidence: { type: Number, default: 0 },
    usedBy: { type: [String], default: [] },
    divergence: { type: divergenceSchema, default: null },
    proof: { type: String, enum: ['executed', 'suspected', 'none'], required: true },
  },
  { _id: false }
);

const prAnalysisSchema = new mongoose.Schema<IPrAnalysis>(
  {
    owner: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    prNumber: { type: Number, required: true },
    headSha: { type: String, required: true, index: true },
    baseSha: { type: String, required: true },
    prUrl: { type: String, required: true },
    changedFunctions: { type: Number, default: 0 },
    findings: { type: [prFindingSchema], default: [] },
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

const PrAnalysisModel = mongoose.model<IPrAnalysis>('PrAnalysis', prAnalysisSchema);

export default PrAnalysisModel;
