import type { FilterQuery, HydratedDocument, UpdateQuery } from 'mongoose';

import type CrudRepository from '../Repository/crud.repository.js';
import type { PaginatedResult, PaginationOptions } from '../Repository/crud.repository.js';

/**
 * Generic service implementing the common business-logic operations on top of a
 * repository. Concrete services extend this class to inherit create/read/update/
 * delete for free, and OVERRIDE any method where they need custom rules — the
 * same way you would override a method in Java and optionally call `super`.
 *
 * The service layer is framework-agnostic (no req/res): it knows nothing about
 * Express, so it can be reused and unit-tested in isolation.
 *
 * @typeParam TDoc        - The raw document interface (e.g. `IResource`).
 * @typeParam TRepository - The concrete repository type, so overrides can reach
 *                          domain-specific query methods without casting.
 */
abstract class CrudService<TDoc, TRepository extends CrudRepository<TDoc> = CrudRepository<TDoc>> {
  protected readonly repository: TRepository;

  constructor(repository: TRepository) {
    if (new.target === CrudService) {
      throw new Error('CrudService is abstract and must be extended.');
    }
    this.repository = repository;
  }

  create(payload: Partial<TDoc>): Promise<HydratedDocument<TDoc>> {
    return this.repository.create(payload);
  }

  getById(id: string): Promise<HydratedDocument<TDoc>> {
    return this.repository.findByIdOrFail(id);
  }

  list(
    filter: FilterQuery<TDoc> = {},
    pagination: PaginationOptions = {}
  ): Promise<PaginatedResult<HydratedDocument<TDoc>>> {
    return this.repository.findAll(filter, pagination);
  }

  update(id: string, payload: UpdateQuery<TDoc>): Promise<HydratedDocument<TDoc>> {
    return this.repository.update(id, payload);
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.repository.destroy(id);
    return { id };
  }
}

export default CrudService;
