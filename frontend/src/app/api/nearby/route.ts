import { NextRequest, NextResponse } from "next/server";
import { WikipediaError, queryWikipedia, wikipediaArticleUrl } from "@/lib/wikipedia";
import type { NearbyCenter, NearbyReference, NearbyResponse } from "@/types/archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Wikipedia geosearch allows at most 10 km.
const RADIUS_METERS = 10_000;

// One vocabulary of heritage nouns, combined into the three filters below.
const HERITAGE_NOUNS = [
  "palace", "chhatri", "temple", "mandir", "monument", "museum", "fort", "mausoleum", "cenotaph", "stepwell",
  "haveli", "durbar", "ruin", "tomb", "gate", "darwaza", "mosque", "church", "kund", "baoli", "vav", "well",
];
// Words that reliably mark a heritage title but read too loosely inside a description.
const TITLE_NOUNS = ["mahal", "minar", "stupa", "gateway", "observatory", "gurdwara", "gurudwara"];
// Extra hints that make a geosearch hit worth a detail lookup, even if they do not prove heritage alone.
const CANDIDATE_HINTS = ["memorial", "rajwada", "bagh", "daly", "gandhi hall"];

const wordPattern = (words: string[]) => `\\b(?:${words.join("|")})\\b`;
const LANDMARK_CANDIDATE = new RegExp(wordPattern([...TITLE_NOUNS, ...HERITAGE_NOUNS, ...CANDIDATE_HINTS]), "i");
const LANDMARK_TITLE = new RegExp(wordPattern([...TITLE_NOUNS, ...HERITAGE_NOUNS]), "i");
const HERITAGE_DESCRIPTION = new RegExp(
  `\\b(?:is|was|are|were)\\s+(?:(?:a|an|the)\\s+)?(?:(?:historical|historic|jain|hindu|royal|maratha|architectural|archaeological)\\s+){0,3}${wordPattern(HERITAGE_NOUNS)}`,
  "i",
);
const TRANSPORT_TITLE = /\b(?:airport|bus|metro|railway|station|train)\b/i;
const PRIORITY_HERITAGE_CATEGORY = /\b(?:world heritage|unesco|monuments? of national importance|protected monuments?)\b/i;
const HERITAGE_CATEGORY = /\b(?:cultural heritage|heritage sites?|historic(?:al)? buildings?|historic monuments?|palaces?|chhatris?|temples?|mandirs?|monuments?|museums?|forts?|stepwells?|havelis?|archaeological sites?)\b/i;

type GeosearchPage = { pageid?: number; title?: string; lat?: number; lon?: number; dist?: number };
type LocatedPage = { pageid: number; title: string; lat: number; lon: number; dist?: number };
type CoordinatePage = { title?: string; missing?: boolean; index?: number; coordinates?: Array<{ lat?: number; lon?: number }> };
type WikiPage = {
  pageid?: number;
  title?: string;
  extract?: string;
  thumbnail?: { source?: string };
  categories?: Array<{ title?: string }>;
};
type WikiResponse<T> = { query?: { geosearch?: T[]; pages?: T[] }; error?: { info?: string } };

function errorResponse(status: number, code: string, error: string, retryAfter?: string | null) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return NextResponse.json({ code, error }, { status, headers });
}

function hasLocation(page: GeosearchPage): page is LocatedPage {
  return Boolean(page.pageid && page.title) && Number.isFinite(page.lat) && Number.isFinite(page.lon);
}

function pageCenter(page: CoordinatePage | undefined): NearbyCenter | null {
  const point = page?.coordinates?.[0];
  if (!page?.title || page.missing || !Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) return null;
  return { title: page.title, latitude: point!.lat!, longitude: point!.lon! };
}

/**
 * Finds coordinates for a place name. First the exact title, following redirects
 * ("IIT Gandhinagar" → "Indian Institute of Technology Gandhinagar"); if that page
 * has no coordinates, the best-ranked search result that does.
 */
async function resolvePlace(name: string): Promise<NearbyCenter | null> {
  const exact = await queryWikipedia<WikiResponse<CoordinatePage>>({
    action: "query", titles: name, redirects: "1", prop: "coordinates",
  });
  const exactCenter = pageCenter(exact.query?.pages?.[0]);
  if (exactCenter) return exactCenter;

  const search = await queryWikipedia<WikiResponse<CoordinatePage>>({
    action: "query", generator: "search", gsrsearch: name, gsrnamespace: "0", gsrlimit: "5", prop: "coordinates",
  });
  const ranked = [...(search.query?.pages || [])].sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  for (const page of ranked) {
    const center = pageCenter(page);
    if (center) return center;
  }
  return null;
}

function parseCoordinate(value: string | null, limit: number): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const near = params.get("near")?.trim().replace(/\s+/g, " ") || "";
  const latitude = parseCoordinate(params.get("lat"), 90);
  const longitude = parseCoordinate(params.get("lon"), 180);
  const hasCoordinates = latitude !== null && longitude !== null;
  if (!hasCoordinates && (params.has("lat") || params.has("lon"))) {
    return errorResponse(400, "INVALID_COORDINATES", "Send both lat (−90 to 90) and lon (−180 to 180).");
  }
  if (!hasCoordinates && (near.length < 2 || near.length > 80)) {
    return errorResponse(400, "INVALID_PLACE", "Enter a place name between 2 and 80 characters.");
  }

  try {
    const center = hasCoordinates
      ? { title: near || "Your location", latitude, longitude }
      : await resolvePlace(near);
    if (!center) {
      return errorResponse(404, "PLACE_NOT_FOUND", `Wikipedia could not place “${near}” on the map. Try a nearby city or town name.`);
    }

    const geosearch = await queryWikipedia<WikiResponse<GeosearchPage>>({
      action: "query",
      list: "geosearch",
      gscoord: `${center.latitude}|${center.longitude}`,
      gsradius: String(RADIUS_METERS),
      gslimit: "50",
      gsprop: "type|name",
      uselang: "content",
    });
    if (geosearch.error) return errorResponse(502, "WIKIPEDIA_BAD_RESPONSE", "Wikipedia returned an invalid nearby-place response.");

    const places = (geosearch.query?.geosearch || [])
      .filter(hasLocation)
      .filter((place) => LANDMARK_CANDIDATE.test(place.title) && !TRANSPORT_TITLE.test(place.title))
      .slice(0, 20);

    const results: NearbyReference[] = [];
    if (places.length > 0) {
      const details = await queryWikipedia<WikiResponse<WikiPage>>({
        action: "query",
        pageids: places.map((place) => place.pageid).join("|"),
        prop: "pageimages|extracts|categories",
        exintro: "1",
        explaintext: "1",
        pithumbsize: "320",
        cllimit: "20",
        clshow: "!hidden",
        uselang: "content",
      });
      if (details.error) return errorResponse(502, "WIKIPEDIA_BAD_RESPONSE", "Wikipedia returned an invalid nearby-place response.");
      const pages = new Map((details.query?.pages || []).map((page) => [page.pageid, page]));

      for (const place of places) {
        const page = pages.get(place.pageid);
        const title = page?.title?.trim();
        if (!page || !title) continue;
        const categories = (page.categories || [])
          .map((item) => item.title?.replace(/^Category:/, ""))
          .filter((item): item is string => Boolean(item));
        const likelyHeritage = LANDMARK_TITLE.test(title)
          || categories.some((category) => HERITAGE_CATEGORY.test(category))
          || HERITAGE_DESCRIPTION.test(page.extract || "");
        if (!likelyHeritage) continue;
        results.push({
          id: `wikipedia:${place.pageid}`,
          title,
          description: (page.extract || "No article summary is available.").slice(0, 900),
          image_url: page.thumbnail?.source || null,
          latitude: place.lat,
          longitude: place.lon,
          distance_meters: Math.round(place.dist || 0),
          article_url: wikipediaArticleUrl(place.pageid),
          source: "Wikipedia",
          categories,
        });
      }
      results.sort((a, b) => {
        const aPriority = a.categories.some((category) => PRIORITY_HERITAGE_CATEGORY.test(category));
        const bPriority = b.categories.some((category) => PRIORITY_HERITAGE_CATEGORY.test(category));
        return Number(bPriority) - Number(aPriority) || a.distance_meters - b.distance_meters;
      });
    }

    const body: NearbyResponse = {
      near: near || center.title,
      center,
      radius_meters: RADIUS_METERS,
      source: "Wikipedia geosearch",
      results,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WikipediaError && error.status === 429) {
      return errorResponse(429, "WIKIPEDIA_RATE_LIMITED", "Nearby lookup is rate limited. Try again shortly.", error.retryAfter);
    }
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return errorResponse(
      timedOut ? 504 : 502,
      timedOut ? "WIKIPEDIA_TIMEOUT" : "WIKIPEDIA_UNAVAILABLE",
      "The free nearby reference service is temporarily unavailable. Please retry later.",
    );
  }
}
