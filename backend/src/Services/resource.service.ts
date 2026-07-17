import type { HydratedDocument } from 'mongoose';

import CrudService from './crud.service.js';
import { ResourceRepository } from '../Repository/index.js';
import { ConflictError } from '../Utils/errors/AppError.js';
import type { IResource } from '../Models/index.js';

interface ResourceServiceDeps {
  resourceRepository?: ResourceRepository;
}

/**
 * Business logic for Resources.
 *
 * It `extends CrudService`, so `getById`, `list`, `update`, and `remove` are
 * inherited as-is — no code needed. We only OVERRIDE `create` because resources
 * have an extra rule (names must be unique). The override does its custom check
 * and then calls `super.create(...)` to reuse the base behaviour — exactly like
 * method overriding + `super` in Java.
 */
class ResourceService extends CrudService<IResource, ResourceRepository> {
  /**
   * Dependencies are injected with a sensible default, which makes the class
   * easy to test (pass a mock repository) while staying convenient in app code.
   */
  constructor({ resourceRepository = new ResourceRepository() }: ResourceServiceDeps = {}) {
    super(resourceRepository);
  }

  /** Overridden: enforce unique name before delegating to the base create. */
  override async create(payload: Partial<IResource>): Promise<HydratedDocument<IResource>> {
    if (payload.name) {
      const existing = await this.repository.findByName(payload.name);
      if (existing) {
        throw new ConflictError(`A resource named "${payload.name}" already exists`);
      }
    }
    return super.create(payload);
  }
}

export default ResourceService;
