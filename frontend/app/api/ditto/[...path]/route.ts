import { NextResponse, type NextRequest } from 'next/server';

/**
 * Same-origin proxy to the Ditto backend.
 *
 * The intelligence map is a Server Component, so it reaches the backend
 * directly. The cluster drawer, however, fetches from the browser — and the
 * browser hitting NEXT_PUBLIC_API_URL (a different origin/port) is a
 * cross-origin request that fails unless the backend sets CORS headers.
 *
 * Rather than depend on the backend's CORS config (which the backend session
 * owns), the browser fetches this route on its OWN origin, and Next forwards
 * the request server-to-server. The drawer works no matter how CORS is set.
 *
 * `/api/ditto/<path>`  ->  `<NEXT_PUBLIC_API_URL>/api/v1/<path>`
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/ditto/[...path]'>) {
  const { path } = await ctx.params;
  const target = `${API_BASE}/api/v1/${path.map(encodeURIComponent).join('/')}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { success: false, message: `Could not reach the Ditto API at ${API_BASE}.`, data: null },
      { status: 502 },
    );
  }

  // Pass the body and status straight through — the frontend's API client
  // understands the envelope, so the proxy stays dumb on purpose.
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
