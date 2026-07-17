import { describe, it, expect, vi } from 'vitest';

import AdjudicateService, { type AdjudicationMember } from '../src/Services/adjudicate.service.js';
import type OpenAIService from '../src/Services/openai.service.js';
import type { Adjudication } from '../src/Models/contracts.js';

/**
 * Stage 2 sees ONE cluster at a time, must be able to reject a bad grouping, and
 * must never nominate a canonical outside the cluster or emit a probe input that
 * is not a JSON argument array.
 */

const adjudication = (
  overrides: Partial<Adjudication & { equivalentMembers: string[] }> = {}
): Adjudication & { equivalentMembers: string[] } => ({
  sameBehavior: true,
  canonicalId: 'fn_1',
  equivalentMembers: ['fn_1', 'fn_2'],
  behaviorSummary: 'normalise a phone number to ten digits',
  differences: ['one strips a country code, the other does not'],
  disagreementRisk: 'semantic',
  confidence: 0.9,
  probeInputs: ['["9876543210"]', '["00919876543210"]'],
  ...overrides,
});

const fakeOpenAI = (impl: (req: unknown) => Adjudication) => {
  const structured = vi.fn().mockImplementation((req: unknown) => Promise.resolve(impl(req)));
  return { service: { structured } as unknown as OpenAIService, structured };
};

const members: AdjudicationMember[] = [
  { id: 'real-a', body: 'function a(s){ return s.replace(/\\D/g,"").slice(-10); }', domain: 'phone-number' },
  { id: 'real-b', body: 'function b(s){ return s.replace(/[^0-9]/g,""); }', domain: 'phone-number' },
];

describe('AdjudicateService.adjudicate', () => {
  it('maps the model canonical label back to a real function id', async () => {
    const { service, structured } = fakeOpenAI(() => adjudication({ canonicalId: 'fn_2' }));
    const result = await new AdjudicateService({ openai: service }).adjudicate(members);

    expect(result?.canonicalId).toBe('real-b');
    // The model saw opaque labels, never the real ids or file paths.
    const user = structured.mock.calls[0][0].user as string;
    expect(user).toContain('fn_1');
    expect(user).not.toContain('real-a');
  });

  it('constrains the canonical to labels in this cluster', async () => {
    const { service, structured } = fakeOpenAI(() => adjudication());
    await new AdjudicateService({ openai: service }).adjudicate(members);

    // The schema handed to the model must enum the two labels, so it CANNOT
    // nominate a function that is not present.
    const schema = structured.mock.calls[0][0].schema;
    const canonical = schema.shape.canonicalId;
    expect(canonical).toBeDefined();
    expect(canonical.options).toEqual(['fn_1', 'fn_2']);
  });

  it('returns null when the model says these are not the same behaviour', async () => {
    const { service } = fakeOpenAI(() => adjudication({ sameBehavior: false, equivalentMembers: [] }));
    const result = await new AdjudicateService({ openai: service }).adjudicate(members);
    // The refusal case — a feature, not a failure.
    expect(result).toBeNull();
  });

  it('keeps only the equivalent SUBSET when the search added a near-miss', async () => {
    // The generous search put three functions together; the flagship judges only
    // two of them equivalent. We must keep those two and drop the odd one, not
    // throw the whole cluster away — that is how the truncateText money shot
    // survives a cluster polluted by truncateToolResultContent.
    const three: AdjudicationMember[] = [
      { id: 'good-a', body: 'function a(s){ return s.slice(0,10); }', domain: 'string' },
      { id: 'good-b', body: 'function b(s){ return s.substring(0,10); }', domain: 'string' },
      { id: 'odd-c', body: 'function c(arr){ return arr.slice(0,10); }', domain: 'collection' },
    ];
    const { service } = fakeOpenAI(() =>
      adjudication({ canonicalId: 'fn_1', equivalentMembers: ['fn_1', 'fn_2'] })
    );

    const result = await new AdjudicateService({ openai: service }).adjudicate(three);

    expect(result).not.toBeNull();
    expect(result!.memberIds).toEqual(['good-a', 'good-b']); // odd-c dropped
    expect(result!.memberIds).not.toContain('odd-c');
    expect(result!.canonicalId).toBe('good-a');
  });

  it('rejects when the equivalent subset collapses below two', async () => {
    // The flagship found no two that match — nothing to cluster.
    const { service } = fakeOpenAI(() =>
      adjudication({ sameBehavior: true, equivalentMembers: ['fn_1'] })
    );
    expect(await new AdjudicateService({ openai: service }).adjudicate(members)).toBeNull();
  });

  it('forces the canonical into the kept subset even if the model named a dropped member', async () => {
    const three: AdjudicationMember[] = [
      { id: 'good-a', body: 'function a(s){ return s.slice(0,10); }', domain: 'string' },
      { id: 'good-b', body: 'function b(s){ return s.substring(0,10); }', domain: 'string' },
      { id: 'odd-c', body: 'function c(arr){ return arr.slice(0,10); }', domain: 'collection' },
    ];
    // Model nominates fn_3 (dropped) as canonical — we must repair to a kept one.
    const { service } = fakeOpenAI(() =>
      adjudication({ canonicalId: 'fn_3', equivalentMembers: ['fn_1', 'fn_2'] })
    );

    const result = await new AdjudicateService({ openai: service }).adjudicate(three);
    expect(result!.memberIds).toEqual(['good-a', 'good-b']);
    expect(['good-a', 'good-b']).toContain(result!.canonicalId);
  });

  it('drops probe inputs that are not JSON argument arrays', async () => {
    const { service } = fakeOpenAI(() =>
      adjudication({ probeInputs: ['["ok"]', 'not json', '"a-bare-string"', '{"not":"an array"}', '[1,2]'] })
    );
    const result = await new AdjudicateService({ openai: service }).adjudicate(members);

    // Only the two real arrays survive; a bare string or object would make the
    // prober fabricate a row.
    expect(result?.probeInputs).toEqual(['["ok"]', '[1,2]']);
  });

  it('clamps confidence into 0-1', async () => {
    const { service } = fakeOpenAI(() => adjudication({ confidence: 1.5 }));
    const result = await new AdjudicateService({ openai: service }).adjudicate(members);
    expect(result?.confidence).toBe(1);
  });

  it('does not call the model for a degenerate single-member cluster', async () => {
    const { service, structured } = fakeOpenAI(() => adjudication());
    const result = await new AdjudicateService({ openai: service }).adjudicate([members[0]]);
    expect(result).toBeNull();
    expect(structured).not.toHaveBeenCalled();
  });

  it('counts rejections and failures across a batch', async () => {
    let call = 0;
    const structured = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve(adjudication());
      if (call === 2) return Promise.resolve(adjudication({ sameBehavior: false }));
      return Promise.reject(new Error('boom'));
    });
    const service = { structured } as unknown as OpenAIService;

    const result = await new AdjudicateService({ openai: service, concurrency: 1 }).adjudicateAll([
      members,
      members,
      members,
    ]);

    expect(result.clusters).toHaveLength(1);
    expect(result.rejected).toBe(1);
    expect(result.failed).toBe(1);
  });
});
