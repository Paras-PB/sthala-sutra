import "server-only";

// Default backend address for local development. scripts/start-standalone.mjs
// applies the same value for `npm start`; keep the two in step.
export const LOCAL_ARCHIVE_API = "http://127.0.0.1:8000";

/**
 * Where the FastAPI backend lives, as seen from this web server.
 * Returns null when nothing is configured outside development.
 */
export function archiveUpstreamBase(): string | null {
  const configured = process.env.HERITAGE_API_URL?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "development" ? LOCAL_ARCHIVE_API : null;
}

/** Resolves a backend path (e.g. "api/artifacts/123") against the base. Throws TypeError for an invalid base. */
export function archiveUrl(base: string, path: string): URL {
  const root = new URL(base.endsWith("/") ? base : `${base}/`);
  return new URL(path.replace(/^\/+/, ""), root);
}
