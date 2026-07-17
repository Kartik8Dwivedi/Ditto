import type { HydratedDocument } from 'mongoose';

import CrudRepository from './crud.repository.js';
import { Resource, type IResource } from '../Models/index.js';

/**
 * Concrete repository for the Resource model. Inherits all generic CRUD from
 * {@link CrudRepository} (typed to {@link IResource}) and adds Resource-specific
 * queries here.
 */
class ResourceRepository extends CrudRepository<IResource> {
  constructor() {
    super(Resource);
  }

  /** Example of a domain-specific query method. */
  async findByName(name: string): Promise<HydratedDocument<IResource> | null> {
    return this.model.findOne({ name }).exec();
  }
}

export default ResourceRepository;
