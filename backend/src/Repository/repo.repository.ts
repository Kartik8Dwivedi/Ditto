import type { HydratedDocument } from 'mongoose';

import CrudRepository from './crud.repository.js';
import { Repo, type IRepo, type RepoStats } from '../Models/index.js';

/** Repository for indexed repository snapshots. */
class RepoRepository extends CrudRepository<IRepo> {
  constructor() {
    super(Repo);
  }

  /**
   * Get-or-create the snapshot for one commit. Re-running the pipeline on a
   * commit we have already seen updates that document rather than creating a
   * second one (the {owner,name,commit} unique index enforces this).
   */
  async upsertSnapshot(owner: string, name: string, commit: string): Promise<HydratedDocument<IRepo>> {
    const doc = await this.model
      .findOneAndUpdate(
        { owner, name, commit },
        { $set: { indexedAt: new Date() }, $setOnInsert: { owner, name, commit } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      )
      .exec();
    return doc;
  }

  /** Most recently indexed snapshot for a repo, across commits. */
  async findLatest(owner: string, name: string): Promise<HydratedDocument<IRepo> | null> {
    return this.model.findOne({ owner, name }).sort({ indexedAt: -1 }).exec();
  }

  /** Every indexed repo, newest first. Powers `GET /api/v1/repos`. */
  async findAllSnapshots(): Promise<HydratedDocument<IRepo>[]> {
    return this.model.find().sort({ indexedAt: -1 }).exec();
  }

  async saveStats(repoId: string, stats: RepoStats): Promise<HydratedDocument<IRepo>> {
    return this.update(repoId, { $set: { stats } });
  }
}

export default RepoRepository;
