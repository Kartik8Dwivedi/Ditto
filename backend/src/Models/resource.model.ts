import mongoose from 'mongoose';

/** Allowed lifecycle states for a Resource. */
export type ResourceStatus = 'active' | 'inactive' | 'archived';

/**
 * The shape of a Resource document. This interface is the single source of
 * truth for the entity's type — the schema below is typed against it, and the
 * repository/service layers are generic over it.
 */
export interface IResource {
  name: string;
  description: string;
  status: ResourceStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Example domain model. "Resource" is a neutral placeholder — copy this file,
 * rename it, and adjust the schema to model your own entity.
 */
const resourceSchema = new mongoose.Schema<IResource>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true, // adds createdAt / updatedAt
    toJSON: {
      virtuals: true,
      // Present a clean API shape: expose `id`, hide Mongo internals.
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

const Resource = mongoose.model<IResource>('Resource', resourceSchema);

export default Resource;
