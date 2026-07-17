import type { FilterQuery, HydratedDocument, Model, SortOrder, UpdateQuery } from 'mongoose';

import { NotFoundError } from '../Utils/errors/AppError.js';

/** Options accepted by paginated list queries. */
export interface PaginationOptions {
  page?: number;
  limit?: number;
  sort?: Record<string, SortOrder>;
}

/** Pagination metadata returned alongside a page of results. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** A page of documents plus its pagination metadata. */
export interface PaginatedResult<T> {
  items: T[];
  meta: PaginationMeta;
}

/**
 * Generic repository implementing the common CRUD operations against a Mongoose
 * model. Concrete repositories extend this class (typed to their document
 * interface) and add query methods specific to their domain (e.g. `findByEmail`).
 *
 * The repository layer is the ONLY layer that talks to the database. Services
 * depend on repositories, never on Mongoose directly — this keeps the data
 * source swappable and the business logic testable.
 *
 * @typeParam TDoc - The raw document interface for the model (e.g. `IResource`).
 */
abstract class CrudRepository<TDoc> {
  protected readonly model: Model<TDoc>;

  constructor(model: Model<TDoc>) {
    if (new.target === CrudRepository) {
      throw new Error('CrudRepository is abstract and must be extended.');
    }
    this.model = model;
  }

  async create(data: Partial<TDoc>): Promise<HydratedDocument<TDoc>> {
    return this.model.create(data);
  }

  async findById(id: string): Promise<HydratedDocument<TDoc> | null> {
    return this.model.findById(id).exec();
  }

  /** Like {@link findById} but throws NotFoundError when nothing matches. */
  async findByIdOrFail(id: string): Promise<HydratedDocument<TDoc>> {
    const doc = await this.findById(id);
    if (!doc) throw new NotFoundError(`${this.model.modelName} not found`);
    return doc;
  }

  async findOne(filter: FilterQuery<TDoc> = {}): Promise<HydratedDocument<TDoc> | null> {
    return this.model.findOne(filter).exec();
  }

  /** Paginated list. Returns the page of documents plus pagination metadata. */
  async findAll(
    filter: FilterQuery<TDoc> = {},
    { page = 1, limit = 20, sort = { createdAt: -1 } }: PaginationOptions = {}
  ): Promise<PaginatedResult<HydratedDocument<TDoc>>> {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.model.find(filter).sort(sort).skip(skip).limit(limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async update(id: string, data: UpdateQuery<TDoc>): Promise<HydratedDocument<TDoc>> {
    const doc = await this.model
      .findByIdAndUpdate(id, data, { new: true, runValidators: true })
      .exec();
    if (!doc) throw new NotFoundError(`${this.model.modelName} not found`);
    return doc;
  }

  async destroy(id: string): Promise<HydratedDocument<TDoc>> {
    const doc = await this.model.findByIdAndDelete(id).exec();
    if (!doc) throw new NotFoundError(`${this.model.modelName} not found`);
    return doc;
  }
}

export default CrudRepository;
