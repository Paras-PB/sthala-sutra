import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };
const MAX_PROXY_UPLOAD_BYTES = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

function apiError(status: number, code: string, error: string) {
  return NextResponse.json(
    { code, error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function proxy(request: NextRequest, context: RouteContext) {
  const configuredUrl = process.env.HERITAGE_API_URL?.trim();
  const upstreamBase = configuredUrl || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "");
  if (!upstreamBase) {
    return apiError(503, "BACKEND_NOT_CONFIGURED", "Archive API is not configured. Set HERITAGE_API_URL on the web server.");
  }

  const { path } = await context.params;
  let target: URL;
  try {
    const base = new URL(upstreamBase.endsWith("/") ? upstreamBase : `${upstreamBase}/`);
    target = new URL(path.map((segment) => encodeURIComponent(segment)).join("/"), base);
    target.search = request.nextUrl.search;
  } catch {
    return apiError(500, "BACKEND_URL_INVALID", "HERITAGE_API_URL must be a valid absolute URL.");
  }

  const headers = new Headers();
  for (const name of ["accept", "content-type", "range", "if-none-match"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (hasBody && contentLength > MAX_PROXY_UPLOAD_BYTES) {
    return apiError(413, "UPLOAD_TOO_LARGE", "The upload exceeds the 25 MB archive limit.");
  }

  try {
    const body = hasBody ? await request.arrayBuffer() : undefined;
    if (body && body.byteLength > MAX_PROXY_UPLOAD_BYTES) {
      return apiError(413, "UPLOAD_TOO_LARGE", "The upload exceeds the 25 MB archive limit.");
    }
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "content-disposition", "etag", "last-modified", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return apiError(
      timedOut ? 504 : 502,
      timedOut ? "BACKEND_TIMEOUT" : "BACKEND_UNAVAILABLE",
      timedOut ? "The archive API did not respond in time." : "The archive API could not be reached. Start the local services or check HERITAGE_API_URL.",
    );
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
