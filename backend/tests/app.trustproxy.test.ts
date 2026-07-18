import { describe, it, expect } from 'vitest';

import createApp from '../src/app.js';

/**
 * Behind Cloud Run, `trust proxy` decides whether `req.ip` is the real client
 * or the proxy. Getting it wrong is silent and expensive: express-rate-limit
 * keys every user into ONE bucket, so a single polling analysis can 429 a judge.
 * These pin the exact value, because both wrong answers are plausible edits.
 */
describe('app trust proxy', () => {
  it('trusts exactly one proxy hop (Cloud Run terminates TLS in front of us)', () => {
    expect(createApp().get('trust proxy')).toBe(1);
  });

  it('is not `true` — that would let a client spoof X-Forwarded-For', () => {
    // With `true`, Express walks to the leftmost X-Forwarded-For entry, which is
    // attacker-controlled: a fresh fake IP per request evades the limiter.
    expect(createApp().get('trust proxy')).not.toBe(true);
  });
});
