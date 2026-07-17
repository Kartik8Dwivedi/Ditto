import type { HydratedDocument } from 'mongoose';

import CrudRepository from './crud.repository.js';
import { ClusterModel, type ICluster } from '../Models/index.js';

/** Repository for adjudicated semantic-duplicate clusters. */
class ClusterRepository extends CrudRepository<ICluster> {
  constructor() {
    super(ClusterModel);
  }

  /** Clusters for a repo, most-suspicious first. */
  async findByRepo(repoId: string): Promise<HydratedDocument<ICluster>[]> {
    return this.model.find({ repoId }).sort({ confidence: -1, cohesion: -1 }).exec();
  }

  /** Clusters are derived data — a pipeline re-run replaces them wholesale. */
  async replaceForRepo(repoId: string, docs: Partial<ICluster>[]): Promise<HydratedDocument<ICluster>[]> {
    await this.model.deleteMany({ repoId }).exec();
    if (docs.length === 0) return [];
    // insertMany widens Partial inputs to a MergeType the compiler will not
    // narrow back; the caller supplies complete documents, so assert the result.
    return this.model.insertMany(docs) as unknown as Promise<HydratedDocument<ICluster>[]>;
  }
}

export default ClusterRepository;
