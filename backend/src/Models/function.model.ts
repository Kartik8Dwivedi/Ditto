import mongoose from 'mongoose';
import type { Types } from 'mongoose';

import type { ExtractedFunction, Fingerprint } from './contracts.js';

/**
 * A function extracted from a repo, plus the two things we derive from it: its
 * behavioural fingerprint (LLM stage 1) and the embedding of that fingerprint.
 *
 * Both derived fields are optional: a function exists in the index the moment
 * the extractor finds it, and gets enriched as the pipeline progresses.
 */
export interface IFunction extends ExtractedFunction {
  repoId: Types.ObjectId;
  fingerprint?: Fingerprint;
  embedding?: number[];
  /**
   * The embed-text recipe (EMBED_VERSION) this document's `embedding` was built
   * under. `bodyHash` is unchanged when the recipe changes, so this stamp is the
   * ONLY thing that distinguishes a current vector from a stale one — without it
   * the cross-repo, content-addressed embedding cache would silently hand back a
   * vector from an older recipe and let it be cosine-compared against current
   * ones. Present iff `embedding` is present.
   */
  embedVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

const fingerprintSchema = new mongoose.Schema<Fingerprint>(
  {
    intent: { type: String, required: true },
    inputs: { type: [String], default: [] },
    outputs: { type: [String], default: [] },
    sideEffects: { type: [String], default: [] },
    domain: { type: String, required: true },
    behavior: { type: [String], default: [] },
    pure: { type: Boolean, required: true },
  },
  { _id: false }
);

const functionSchema = new mongoose.Schema<IFunction>(
  {
    repoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repo', required: true },
    name: { type: String, required: true },
    file: { type: String, required: true },
    startLine: { type: Number, required: true },
    endLine: { type: Number, required: true },
    signature: { type: String, default: '' },
    body: { type: String, required: true },
    bodyHash: { type: String, required: true },
    loc: { type: Number, required: true },
    isExported: { type: Boolean, default: false },
    params: { type: [String], default: [] },
    returnTypeText: { type: String, default: '' },
    imports: { type: [String], default: [] },
    callsExternal: { type: Boolean, default: false },
    isPure: { type: Boolean, default: false },
    language: { type: String, enum: ['ts', 'python'], default: 'ts' },
    fingerprint: { type: fingerprintSchema, default: undefined },
    embedding: { type: [Number], default: undefined },
    embedVersion: { type: String, default: undefined },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        // 1536 floats have no business in an HTTP response.
        delete ret.embedding;
        return ret;
      },
    },
  }
);

// THE cache key. A fingerprint is a pure function of the body, so an unchanged
// body never gets fingerprinted twice — this is what makes re-runs free.
functionSchema.index({ repoId: 1, bodyHash: 1 });
functionSchema.index({ repoId: 1 });
// Content-addressed lookups across repos, so a body we have already paid to
// fingerprint is free everywhere it reappears.
functionSchema.index({ bodyHash: 1 });

const FunctionModel = mongoose.model<IFunction>('Function', functionSchema);

export default FunctionModel;
