import "server-only";

export const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
// Wikimedia asks API clients to identify themselves with a contact URL.
export const WIKIPEDIA_USER_AGENT = "SthalaSutra/0.3 (https://github.com/dhrrishitvdeka/sthala-sutra)";
const DEFAULT_TIMEOUT_MS = 10_000;

export class WikipediaError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null) {
    super(`Wikipedia returned ${status}.`);
    this.name = "WikipediaError";
  }
}

export function wikipediaArticleUrl(pageId: number | string): string {
  return `https://en.wikipedia.org/?curid=${pageId}`;
}

/**
 * Calls the MediaWiki Action API with JSON format v2. Responses are cached for an
 * hour by Next.js, so repeated lookups of the same place stay light on Wikimedia.
 */
export async function queryWikipedia<T>(params: Record<string, string>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const search = new URLSearchParams({
    ...params,
    format: "json",
    formatversion: "2",
    maxage: "3600",
    smaxage: "3600",
  });
  const response = await fetch(`${WIKIPEDIA_API}?${search}`, {
    headers: { "User-Agent": WIKIPEDIA_USER_AGENT, Accept: "application/json" },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new WikipediaError(response.status, response.headers.get("retry-after"));
  return await response.json() as T;
}
