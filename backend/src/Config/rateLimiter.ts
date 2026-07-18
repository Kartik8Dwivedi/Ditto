import rateLimit from 'express-rate-limit';
import type { Express } from 'express';

/**
 * Global per-IP rate limiter.
 *
 * Requires `app.set('trust proxy', 1)` (see app.ts) — otherwise every client
 * behind Cloud Run's proxy is keyed to the same address and shares one bucket.
 *
 * THE BUDGET, and why it is not smaller. The frontend polls `GET /jobs/:id`
 * every 2s for the whole of a running analysis — 30 requests/minute, sustained
 * for as long as the run takes (up to the 18-minute live deadline). Over one
 * 10-minute window that is ~300 polls from a single honest user before they
 * have loaded a single page:
 *
 *   polling  300  (10 min at 2s)
 *   browsing  ~50 (repo map, a few cluster detail views, reloads)
 *   ---------------
 *   ~350 for ONE user running ONE analysis
 *
 * The old limit of 500 left almost no room: a second browser tab, or a run that
 * spans two windows, would 429 a legitimate user mid-analysis. It gets worse at
 * a venue, where every judge on the same WiFi shares one NAT egress IP — five
 * concurrent users would blow a 500 budget outright while doing nothing wrong.
 *
 * 2000/10min (~3.3 req/s sustained) fits roughly five concurrent analyses from
 * a single NAT'd IP and still stops a flood. This is safe to be generous with
 * because it guards only cheap reads: the expensive path is protected on its own
 * terms — `/analyze` by dedup plus the global 20-analysis cap, and
 * `/internal/run` by the shared-secret header.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 2000;

const rateLimiter = (app: Express): void => {
  const limiter = rateLimit({
    windowMs: WINDOW_MS,
    max: MAX_REQUESTS,
    standardHeaders: true, // expose RateLimit-* headers
    legacyHeaders: false, // disable deprecated X-RateLimit-* headers
    // Liveness probes are infrastructure, not user traffic, and Cloud Run polls
    // them continuously — they must never consume a real client's budget.
    skip: (req) => req.path === '/health',
    message: { success: false, message: 'Too many requests, please try again later.' },
  });
  app.use(limiter);
};

export default rateLimiter;
