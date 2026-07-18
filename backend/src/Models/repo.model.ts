import mongoose from 'mongoose';

import type { RepoStats } from './contracts.js';

/** One indexed snapshot of a repository, at one commit. */
export interface IRepo {
  owner: string;
  name: string;
  commit: string;
  indexedAt: Date;
  stats: RepoStats;
  /**
   * Which embed-text recipe the stored function embeddings were built with.
   * Embeddings are cached by bodyHash, but changing the embed TEXT invalidates
   * them without changing any hash — so this version stamp is how we know
   * whether the cache is stale and must be recomputed.
   */
  embedVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Denormalised stats. These are recomputed wholesale by the pipeline on every
 * run and read straight back out by the Intelligence Map, so they live on the
 * repo document rather than being aggregated per request.
 */
const statsSchema = new mongoose.Schema<RepoStats>(
  {
    functions: { type: Number, default: 0 },
    files: { type: Number, default: 0 },
    modules: { type: Number, default: 0 },
    semanticDuplicateClusters: { type: Number, default: 0 },
    behavioralConflicts: { type: Number, default: 0 },
    nearDuplicates: { type: Number, default: 0 },
    reusableUtilities: { type: Number, default: 0 },
    suspectedReinvented: { type: Number, default: 0 },
    linesRemovable: { type: Number, default: 0 },
    callSitesUnifiable: { type: Number, default: 0 },
    healthScore: { type: Number, default: 100 },
    functionsAnalyzed: { type: Number, default: 0 },
    functionsTotal: { type: Number, default: 0 },
  },
  { _id: false }
);

const repoSchema = new mongoose.Schema<IRepo>(
  {
    owner: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    commit: { type: String, required: true, trim: true },
    indexedAt: { type: Date, required: true, default: () => new Date() },
    stats: { type: statsSchema, required: true, default: () => ({}) },
    embedVersion: { type: String },
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

// One document per repo per commit — re-running the pipeline on the same commit
// updates in place rather than piling up snapshots.
repoSchema.index({ owner: 1, name: 1, commit: 1 }, { unique: true });

const Repo = mongoose.model<IRepo>('Repo', repoSchema);

export default Repo;
