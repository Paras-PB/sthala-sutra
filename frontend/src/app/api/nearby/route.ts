import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const QUERY_TIMEOUT_MS = 10_000;
const LANDMARK_CANDIDATE = /\b(?:palace|mahal|minar|stupa|gateway|observatory|gurdwara|gurudwara|chhatri|temple|mandir|monument|museum|fort|mausoleum|memorial|cenotaph|stepwell|haveli|durbar|ruin|tomb|gate|darwaza|mosque|church|kund|baoli|vav|well|rajwada|bagh|daly|gandhi hall)\b/i;
const LANDMARK_TITLE = /\b(?:palace|mahal|minar|stupa|gateway|observatory|gurdwara|gurudwara|chhatri|temple|mandir|monument|museum|fort|mausoleum|cenotaph|stepwell|haveli|durbar|ruin|tomb|gate|darwaza|mosque|church|kund|baoli|vav|well)\b/i;
const TRANSPORT_TITLE = /\b(?:airport|bus|metro|railway|station|train)\b/i;
const PRIORITY_HERITAGE_CATEGORY = /\b(?:world heritage|unesco|monuments? of national importance|protected monuments?)\b/i;
const HERITAGE_CATEGORY = /\b(?:cultural heritage|heritage sites?|historic(?:al)? buildings?|historic monuments?|palaces?|chhatris?|temples?|mandirs?|monuments?|museums?|forts?|stepwells?|havelis?|archaeological sites?)\b/i;
const HERITAGE_DESCRIPTION = /\b(?:is|was|are|were)\s+(?:(?:a|an|the)\s+)?(?:(?:historical|historic|jain|hindu|royal|maratha|architectural|archaeological)\s+){0,3}(?:palace|chhatri|temple|mandir|monument|museum|fort|mausoleum|cenotaph|stepwell|haveli|durbar|ruin|tomb|gate|darwaza|mosque|church|kund|baoli|vav|well)\b/i;

type GeosearchPage = {
  pageid?: number;
  title?: string;
  lat?: number;
  lon?: number;
  dist?: number;
};

type WikiPage = {
  pageid?: number;
  title?: string;
  extract?: string;
  thumbnail?: { source?: string };
  categories?: Array<{ title?: string }>;
};

type WikiResponse<T> = { query?: { geosearch?: T[]; pages?: T[] }; error?: { info?: string } };

const wikiHeaders = {
  "User-Agent": "SthalaSutra/0.2 (https://github.com/Paras-PB/sthala-sutra; contact via repository)",
  Accept: "application/json",
};

function errorResponse(status: number, code: string, error: string, retryAfter?: string | null) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return NextResponse.json({ code, error }, { status, headers });
}

function wikiParams(values: Record<string, string>) {
  return new URLSearchParams({
    ...values,
    format: "json",
    formatversion: "2",
    uselang: "content",
    maxage: "3600",
    smaxage: "3600",
  });
}

async function queryWikipedia(params: URLSearchParams) {
  const response = await fetch(`${WIKIPEDIA_API}?${params}`, {
    headers: wikiHeaders,
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`Wikipedia returned ${response.status}.`);
    Object.assign(error, { status: response.status, retryAfter: response.headers.get("retry-after") });
    throw error;
  }
  return response.json();
}

export async function GET(request: NextRequest) {
  const near = request.nextUrl.searchParams.get("near")?.trim().replace(/\s+/g, " ") || "";
  if (near.length < 2 || near.length > 80) {
    return errorResponse(400, "INVALID_PLACE", "Enter a place name between 2 and 80 characters.");
  }

  try {
    const geosearch = await queryWikipedia(wikiParams({
      action: "query",
      list: "geosearch",
      gspage: near,
      gsradius: "10000",
      gslimit: "50",
      gsprop: "type|name",
    })) as WikiResponse<GeosearchPage>;
    if (geosearch.error) {
      return errorResponse(404, "PLACE_NOT_FOUND", `Wikipedia could not find a page for “${near}”. Try a nearby city or town name.`);
    }

    const places = (geosearch.query?.geosearch || [])
      .filter((place) => Boolean(place.pageid)
        && Number.isFinite(place.lat)
        && Number.isFinite(place.lon)
        && LANDMARK_CANDIDATE.test(place.title || "")
        && !TRANSPORT_TITLE.test(place.title || ""))
      .slice(0, 20);
    if (places.length === 0) {
      return NextResponse.json(
        { near, radius_meters: 10_000, source: "Wikipedia geosearch", results: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // Wikimedia requests are deliberately sequential and cached to keep this human-triggered lookup light.
    const detailParams = wikiParams({
      action: "query",
      pageids: places.map((place) => place.pageid).join("|"),
      prop: "pageimages|extracts|categories",
      exintro: "1",
      explaintext: "1",
      pithumbsize: "320",
      cllimit: "20",
      clshow: "!hidden",
    });
    const details = await queryWikipedia(detailParams) as WikiResponse<WikiPage>;
    if (details.error) return errorResponse(502, "WIKIPEDIA_BAD_RESPONSE", "Wikipedia returned an invalid nearby-place response.");
    const pages = new Map((details.query?.pages || []).map((page) => [page.pageid, page]));
    const results = places.flatMap((place) => {
      const page = pages.get(place.pageid);
      if (!page) return [];
      const title = page.title?.trim();
      if (!title || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return [];
      const categories = (page.categories || [])
        .map((item) => item.title?.replace(/^Category:/, ""))
        .filter((item): item is string => Boolean(item));
      const likelyHeritage = LANDMARK_TITLE.test(title)
        || categories.some((category) => HERITAGE_CATEGORY.test(category))
        || HERITAGE_DESCRIPTION.test(page.extract || "");
      if (!likelyHeritage) return [];
      const pageId = place.pageid!;
      return [{
        id: `wikipedia:${pageId}`,
        title,
        description: (page.extract || "No article summary is available.").slice(0, 900),
        image_url: page.thumbnail?.source || null,
        latitude: place.lat!,
        longitude: place.lon!,
        distance_meters: Math.round(place.dist || 0),
        article_url: `https://en.wikipedia.org/?curid=${pageId}`,
        source: "Wikipedia",
        categories,
      }];
    });
    results.sort((a, b) => {
      const aPriority = a.categories.some((category) => PRIORITY_HERITAGE_CATEGORY.test(category));
      const bPriority = b.categories.some((category) => PRIORITY_HERITAGE_CATEGORY.test(category));
      return Number(bPriority) - Number(aPriority) || a.distance_meters - b.distance_meters;
    });

    return NextResponse.json(
      { near, radius_meters: 10_000, source: "Wikipedia geosearch", results },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
    const retryAfter = typeof error === "object" && error !== null && "retryAfter" in error ? String(error.retryAfter || "") : null;
    if (status === 429) return errorResponse(429, "WIKIPEDIA_RATE_LIMITED", "Nearby lookup is rate limited. Try again shortly.", retryAfter);
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return errorResponse(
      timedOut ? 504 : 502,
      timedOut ? "WIKIPEDIA_TIMEOUT" : "WIKIPEDIA_UNAVAILABLE",
      "The free nearby reference service is temporarily unavailable. Please retry later.",
    );
  }
}
