import { describe, expect, it } from 'vitest';

import { flaggedResultIds } from '@/components/cluster/divergence-table';
import type { DivergenceRow } from '@/types/ditto';

const divergenceRow = (overrides: Partial<DivergenceRow> = {}): DivergenceRow => ({
  input: 'sample',
  results: [],
  diverged: true,
  ...overrides,
});

describe('flaggedResultIds divergence highlighting', () => {
  it.each([
    {
      name: 'flags outputs that differ from the canonical result',
      row: divergenceRow({
        results: [
          { functionId: 'canonical', output: 'same' },
          { functionId: 'first', output: 'odd' },
          { functionId: 'second', output: 'same' },
        ],
      }),
      canonicalId: 'canonical',
      expected: ['first'],
    },
    {
      name: 'flags the minority when a 2-of-3 majority exists without a canonical result',
      row: divergenceRow({
        results: [
          { functionId: 'first', output: 'common' },
          { functionId: 'second', output: 'minority' },
          { functionId: 'third', output: 'common' },
        ],
      }),
      canonicalId: undefined,
      expected: ['second'],
    },
    {
      name: 'flags all results when outputs are distinct and no canonical result exists',
      row: divergenceRow({
        results: [
          { functionId: 'first', output: 'one' },
          { functionId: 'second', output: 'two' },
        ],
      }),
      canonicalId: undefined,
      expected: ['first', 'second'],
    },
    {
      name: 'returns an empty set for a non-diverged row',
      row: divergenceRow({
        results: [
          { functionId: 'first', output: 'same' },
          { functionId: 'second', output: 'same' },
        ],
        diverged: false,
      }),
      canonicalId: undefined,
      expected: [],
    },
    {
      name: 'flags nothing when the row is not diverged, even if a cell threw',
      row: divergenceRow({
        results: [
          { functionId: 'first', output: '', error: 'TypeError' },
          { functionId: 'second', output: '', error: 'TypeError' },
          { functionId: 'third', output: '', error: 'TypeError' },
        ],
        diverged: false,
      }),
      canonicalId: 'first',
      expected: [],
    },
    {
      name: 'flags the throw and divergent results inside a diverged row',
      row: divergenceRow({
        results: [
          { functionId: 'canonical-throw', output: '', error: 'TypeError' },
          { functionId: 'second', output: 'two' },
          { functionId: 'third', output: 'three' },
        ],
      }),
      canonicalId: 'canonical-throw',
      expected: ['canonical-throw', 'second', 'third'],
    },
  ] satisfies {
    name: string;
    row: DivergenceRow;
    canonicalId: string | undefined;
    expected: string[];
  }[])('$name', ({ row, canonicalId, expected }) => {
    expect(flaggedResultIds(row, canonicalId)).toEqual(new Set(expected));
  });
});
