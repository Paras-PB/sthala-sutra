// Error helpers shared by the browser code and the route handlers.

/** Turns a thrown value into a sentence that can be shown to the user. */
export function readableError(error: unknown, fallback: string): string {
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return "Could not reach the archive API. Check its address and make sure the backend is running.";
  }
  return error instanceof Error ? error.message : fallback;
}

/** Reads `{ error }` (our routes) or `{ detail }` (FastAPI) from a failed response. */
export async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown; detail?: unknown } | null;
  if (typeof body?.error === "string") return body.error;
  if (typeof body?.detail === "string") return body.detail;
  return fallback;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Error that remembers the HTTP status, so callers can tell "not found" from "down". */
export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

/** fetch + JSON parse; throws HttpError with the server's own message when the status is not 2xx. */
export async function fetchJson<T>(url: string, fallbackError: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new HttpError(await responseError(response, fallbackError), response.status);
  return await response.json() as T;
}
