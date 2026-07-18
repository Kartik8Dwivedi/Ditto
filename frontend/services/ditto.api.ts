/**
 * The Ditto API client — the ONLY place that knows where data comes from.
 *
 * DEFAULT: the live backend at NEXT_PUBLIC_API_URL (default
 * http://localhost:3001). The fixtures are the fallback, one flag away:
 *
 *   NEXT_PUBLIC_DITTO_SOURCE=mock   →  render from typed fixtures, no backend
 *   (anything else / unset)         →  hit the real API
 *
 * Fixtures and HTTP responses are the same shapes (`types/ditto.ts`), so the
 * two sources are interchangeable and nothing downstream changes.
 *
 * There is deliberately NO silent fallback from api to mock. If the API is the
 * source and it fails, the UI shows a real error — quietly serving fixtures
 * while claiming to have analysed a live repo is the same class of lie as
 * showing predicted output as executed. Switch to fixtures explicitly.
 *
 * Server vs browser:
 *   - Server Components reach the backend directly (`API_BASE/api/v1/...`).
 *   - The browser (the cluster drawer) goes through the same-origin proxy at
 *     app/api/ditto/[...path] so the backend's CORS config can never break it.
 */
import type {
  AnalyzeResponse,
  ApiEnvelope,
  ClusterDetail,
  Job,
  RepoDetail,
  RepoSummary,
} from '@/types/ditto';
import { getMockCluster, getMockRepo, getMockRepos } from '@/lib/mocks';
import { parseGitHubRepo } from '@/lib/github';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** `api` (default) talks to the backend; `mock` reads fixtures. */
const SOURCE = process.env.NEXT_PUBLIC_DITTO_SOURCE === 'mock' ? 'mock' : 'api';

export const isUsingMockData = SOURCE === 'mock';

/**
 * The fixtures resolve instantly, which would make the pipeline progress list
 * flash past. A small delay lets the analysis stages actually be read. It
 * applies to fixtures only — the real API has its own latency.
 */
const MOCK_LATENCY_MS = 650;

export type DittoErrorKind = 'not_found' | 'network' | 'bad_response';

export class DittoApiError extends Error {
  readonly kind: DittoErrorKind;
  readonly status?: number;

  constructor(message: string, kind: DittoErrorKind, status?: number) {
    super(message);
    this.name = 'DittoApiError';
    this.kind = kind;
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * On the server, reach the backend directly. In the browser, use the
 * same-origin proxy so there is no cross-origin request to configure.
 * `path` is a backend path minus the `/api/v1` prefix, e.g. `/repos`.
 */
function endpoint(path: string): string {
  return typeof window === 'undefined' ? `${API_BASE}/api/v1${path}` : `/api/ditto${path}`;
}

/**
 * Cloud Run cold starts and scale-ups surface as a transient 502/503/504 or a
 * dropped connection. Those are worth one more try; a 4xx never is.
 */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const MAX_GET_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;

async function request<T>(path: string, body?: unknown): Promise<T> {
  const url = endpoint(path);
  const isPost = body !== undefined;

  let response: Response;
  let attempt = 0;

  for (;;) {
    attempt += 1;
    // Only GETs are retried. POST /analyze is not idempotent — retrying it
    // could queue a second (paid) analysis for the same repo.
    const canRetry = !isPost && attempt < MAX_GET_ATTEMPTS;

    try {
      response = await fetch(url, {
        method: isPost ? 'POST' : 'GET',
        headers: isPost
          ? { accept: 'application/json', 'content-type': 'application/json' }
          : { accept: 'application/json' },
        body: isPost ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      if (canRetry) {
        await sleep(RETRY_BASE_MS * attempt);
        continue;
      }
      throw new DittoApiError(`Could not reach the Ditto API at ${API_BASE}.`, 'network');
    }

    if (canRetry && TRANSIENT_STATUSES.has(response.status)) {
      await sleep(RETRY_BASE_MS * attempt);
      continue;
    }
    break;
  }

  if (response.status === 404) {
    throw new DittoApiError('Not found.', 'not_found', 404);
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new DittoApiError(
      'The API returned a response that was not the expected JSON envelope.',
      'bad_response',
      response.status,
    );
  }

  if (!response.ok || !envelope || envelope.success !== true) {
    throw new DittoApiError(
      envelope?.message || `The API returned ${response.status}.`,
      response.status === 404 ? 'not_found' : 'bad_response',
      response.status,
    );
  }

  return envelope.data;
}

/** GET /api/v1/repos */
export async function fetchRepos(): Promise<RepoSummary[]> {
  if (SOURCE === 'mock') {
    await sleep(MOCK_LATENCY_MS / 4);
    return getMockRepos();
  }
  return request<RepoSummary[]>('/repos');
}

/** GET /api/v1/repos/:repoId */
export async function fetchRepo(repoId: string): Promise<RepoDetail> {
  if (SOURCE === 'mock') {
    await sleep(MOCK_LATENCY_MS);
    const repo = getMockRepo(repoId);
    if (!repo) throw new DittoApiError(`No indexed repo with id "${repoId}".`, 'not_found', 404);
    return repo;
  }
  return request<RepoDetail>(`/repos/${encodeURIComponent(repoId)}`);
}

/** GET /api/v1/clusters/:clusterId */
export async function fetchCluster(clusterId: string): Promise<ClusterDetail> {
  if (SOURCE === 'mock') {
    await sleep(MOCK_LATENCY_MS / 2);
    const cluster = getMockCluster(clusterId);
    if (!cluster) throw new DittoApiError(`No cluster with id "${clusterId}".`, 'not_found', 404);
    return cluster;
  }
  return request<ClusterDetail>(`/clusters/${encodeURIComponent(clusterId)}`);
}

/**
 * POST /api/v1/analyze — kick off (or dedup) an on-demand analysis.
 *
 * Returns `{ jobId, repoId: null }` for a new queued analysis (poll the job),
 * or `{ jobId: null, repoId }` when the repo was already analysed (navigate now).
 * See docs/ONDEMAND.md.
 */
export async function analyzeRepo(repoUrl: string): Promise<AnalyzeResponse> {
  // Normalise to a canonical URL before sending. The backend requires a full
  // github.com URL and rejects the `owner/name` shorthand, so we always send
  // the canonical form even though the paste box accepts the shorthand.
  const ref = parseGitHubRepo(repoUrl);
  const canonicalUrl = ref ? `https://github.com/${ref.owner}/${ref.name}` : repoUrl.trim();

  if (SOURCE === 'mock') {
    await sleep(MOCK_LATENCY_MS / 3);
    // Offline dedup: a pasted URL for a repo we already ship as a fixture goes
    // straight to its map. Anything else cannot be analysed without the backend,
    // and we say so honestly rather than faking a progress bar to nowhere.
    if (ref) {
      const match = getMockRepos().find(
        (r) => r.owner.toLowerCase() === ref.owner.toLowerCase() && r.name.toLowerCase() === ref.name.toLowerCase(),
      );
      if (match) return { jobId: null, repoId: match.id };
    }
    throw new DittoApiError(
      'Live on-demand analysis needs the Ditto backend running. Explore the pre-analysed repositories below, or point NEXT_PUBLIC_DITTO_SOURCE at the API.',
      'bad_response',
    );
  }
  return request<AnalyzeResponse>('/analyze', { repoUrl: canonicalUrl });
}

/** GET /api/v1/jobs/:jobId — poll an in-flight analysis. */
export async function getJob(jobId: string): Promise<Job> {
  if (SOURCE === 'mock') {
    // Mock mode never hands out a jobId (analyzeRepo either dedups or throws),
    // so reaching here means something is wrong — fail loudly rather than hang.
    throw new DittoApiError('Job polling is not available without the backend.', 'not_found', 404);
  }
  return request<Job>(`/jobs/${encodeURIComponent(jobId)}`);
}
