import { describe, expect, it } from 'vitest';
import { PIPELINE_STAGES, stageStatus } from '@/lib/constants';

describe('stageStatus', () => {
    it.each([
        [-1, 0, 'pending'],
        [3, 3, 'running'],
        [PIPELINE_STAGES.length, 0, 'done'],
    ])('returns %s for index=%i, active=%i', (active, index, expected) => {
        expect(stageStatus(index, active)).toBe(expected);
    });
});