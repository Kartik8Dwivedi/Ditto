import type { HydratedDocument, Types } from 'mongoose';

import CrudRepository from './crud.repository.js';
import { FunctionModel, type IFunction, type Fingerprint } from '../Models/index.js';

/** A previously-computed fingerprint + embedding, keyed by body content. */
export interface CachedDerivation {
  bodyHash: string;
  fingerprint: Fingerprint;
  embedding: number[];
}

/** Repository for extracted functions and their derived fingerprints/embeddings. */
class FunctionRepository extends CrudRepository<IFunction> {
  constructor() {
    super(FunctionModel);
  }

  async findByRepo(repoId: string): Promise<HydratedDocument<IFunction>[]> {
    return this.model.find({ repoId }).exec();
  }

  async findByIds(ids: string[]): Promise<HydratedDocument<IFunction>[]> {
    return this.model.find({ _id: { $in: ids } }).exec();
  }

  /**
   * Members of a cluster, WITHOUT their embeddings.
   *
   * The 1536-float vector is roughly 12KB per function and is never rendered —
   * it exists for clustering, which has already happened by the time anything
   * reads a cluster. Excluding it keeps the detail view's payload to the bodies
   * we actually display.
   */
  async findByIdsForDisplay(ids: string[]): Promise<HydratedDocument<IFunction>[]> {
    if (ids.length === 0) return [];
    return this.model.find({ _id: { $in: ids } }).select('-embedding').exec();
  }

  /**
   * Just `loc`, for specific functions.
   *
   * The Intelligence Map needs line counts and nothing else, but a function
   * document carries its full source body AND a 1536-float embedding. Loading
   * whole documents to read one number off each meant ~30MB over the wire and
   * ~6.5s for a repo the size of cline. This projection is the difference
   * between an 8s page and a fast one, so resist widening it: if a caller needs
   * more fields, give it its own method rather than growing this one.
   */
  async findLocsByIds(ids: string[]): Promise<Array<{ _id: Types.ObjectId; loc: number }>> {
    if (ids.length === 0) return [];
    return this.model
      .find({ _id: { $in: ids } })
      .select('loc')
      .lean<Array<{ _id: Types.ObjectId; loc: number }>>()
      .exec();
  }

  /**
   * Load every fingerprint/embedding we already own for these body hashes.
   *
   * Deliberately NOT scoped to a repo: a fingerprint is a pure function of the
   * body text, so a body we have paid for once is free everywhere it turns up.
   * Lean because we only want three fields and there may be thousands of rows.
   */
  async findCachedDerivations(bodyHashes: string[]): Promise<CachedDerivation[]> {
    if (bodyHashes.length === 0) return [];
    const rows = await this.model
      .find({
        bodyHash: { $in: bodyHashes },
        fingerprint: { $exists: true, $ne: null },
        embedding: { $exists: true, $ne: [] },
      })
      .select('bodyHash fingerprint embedding')
      .lean<CachedDerivation[]>()
      .exec();
    return rows;
  }

  /**
   * Replace this repo's whole function set in one go.
   *
   * The extractor is the source of truth for which functions exist at a commit,
   * so a re-run is a wholesale replacement. Cached fingerprints survive because
   * the caller reads them out (via {@link findCachedDerivations}) before calling
   * this and writes them back in with the new documents.
   */
  async replaceForRepo(repoId: string, docs: Partial<IFunction>[]): Promise<HydratedDocument<IFunction>[]> {
    await this.model.deleteMany({ repoId }).exec();
    if (docs.length === 0) return [];
    // insertMany widens Partial inputs to a MergeType the compiler will not
    // narrow back; the caller supplies complete documents, so assert the result.
    return this.model.insertMany(docs) as unknown as Promise<HydratedDocument<IFunction>[]>;
  }
}

export default FunctionRepository;
