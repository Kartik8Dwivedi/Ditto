import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import ClusterModel from '../src/Models/cluster.model.js';

/**
 * BUG 1 regression — a divergence result that THREW (error, no output) must
 * validate. `required: true` on `output` treated the empty string a throw
 * produces as "missing" and aborted the whole cluster save, which is why a
 * ₹180 run wrote zero clusters.
 *
 * Validated offline with `validateSync()` — no database connection needed.
 */

const baseCluster = {
  repoId: new mongoose.Types.ObjectId(),
  functionIds: [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()],
  canonicalId: new mongoose.Types.ObjectId(),
  sameBehavior: true,
  behaviorSummary: 'normalise a phone number',
  domain: 'phone-number',
  differences: ['one keeps the country code'],
  disagreementRisk: 'semantic' as const,
  confidence: 0.95,
  probeInputs: ['["00919876543210"]'],
};

describe('ClusterModel divergence schema', () => {
  it('accepts a result that threw (error present, output empty)', () => {
    const doc = new ClusterModel({
      ...baseCluster,
      divergence: {
        executed: true,
        rows: [
          {
            input: '[null]',
            diverged: true,
            results: [
              { functionId: 'a', output: '"9876543210"' },
              { functionId: 'b', output: '', error: 'TypeError: cannot read length of null' },
            ],
          },
        ],
      },
    });

    // Before the fix this returned a ValidationError and the cluster never saved.
    expect(doc.validateSync()).toBeUndefined();
  });

  it('accepts a normal returning result', () => {
    const doc = new ClusterModel({
      ...baseCluster,
      divergence: {
        executed: true,
        rows: [
          {
            input: '["00919876543210"]',
            diverged: true,
            results: [
              { functionId: 'a', output: '"9876543210"' },
              { functionId: 'b', output: '"919876543210"' },
            ],
          },
        ],
      },
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('rejects a result that carries neither an output nor an error', () => {
    const doc = new ClusterModel({
      ...baseCluster,
      divergence: {
        executed: true,
        rows: [
          {
            input: '[1]',
            diverged: false,
            results: [{ functionId: 'a', output: '', error: '' }],
          },
        ],
      },
    });
    // A result must record SOMETHING — this can only happen on a producer bug.
    expect(doc.validateSync()).toBeDefined();
  });

  it('saves cleanly with no divergence table at all (probe was skipped)', () => {
    const doc = new ClusterModel(baseCluster);
    expect(doc.validateSync()).toBeUndefined();
  });
});
