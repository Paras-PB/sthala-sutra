"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ArchiveFilters from "@/components/ArchiveFilters";
import ArtifactCard, { ArtifactCardSkeleton } from "@/components/ArtifactCard";
import ArtifactReader from "@/components/ArtifactReader";
import NearbyResults, { NearbyReferenceModal } from "@/components/NearbyResults";
import SearchHero from "@/components/SearchHero";
import UploadModal from "@/components/UploadModal";
import { API, ARCHIVE_RADIUS_KM, FALLBACK_CATEGORIES, filterParams, nearbyPlaceFromQuery } from "@/lib/archive-client";
import { HttpError, fetchJson, isAbortError, readableError } from "@/lib/http";
import type {
  ArchiveArtifact, ArchiveFilters as Filters, Facets, NearbyCenter, NearbyReference, NearbyResponse, SearchHit,
} from "@/types/archive";

const HeritageMap = dynamic(() => import("@/components/HeritageMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Preparing the map…</div>,
});

const NO_FILTERS: Filters = { region: "", category: "", era: "" };
const NO_REFERENCES: NearbyReference[] = [];
type Coordinates = { latitude: number; longitude: number };

/** Everything the results area needs for one search. */
type SearchState = {
  /** Text sent to the search endpoint (may be empty for "Near me"). */
  text: string;
  /** What the results bar shows. */
  label: string;
  loading: boolean;
  /** Set when the query named a place (or used "Near me") and Wikipedia located it. */
  center: NearbyCenter | null;
  references: NearbyReference[] | null;
  referencesError: string;
  /** Explains a fallback, e.g. an unknown place name. */
  notice: string;
  /** null while loading or when the archive is unreachable. */
  hits: SearchHit[] | null;
  archiveError: string;
};

type Selection = { artifact: ArchiveArtifact; pageNumber: number };

async function fetchNearby(place: string | null, coordinates?: Coordinates): Promise<NearbyResponse> {
  const params = coordinates
    ? new URLSearchParams({ lat: String(coordinates.latitude), lon: String(coordinates.longitude) })
    : new URLSearchParams({ near: place ?? "" });
  return fetchJson<NearbyResponse>(`/api/nearby?${params}`, "Nearby references could not be loaded.", { cache: "no-store" });
}

async function searchArchive(query: string, center: NearbyCenter | null, filters: Filters): Promise<{ hits: SearchHit[] | null; error: string }> {
  const params = filterParams(filters);
  // The search endpoint needs some text; "Near me" without a query searches broadly.
  params.set("q", query.trim() || "heritage");
  if (center) {
    params.set("lat", String(center.latitude));
    params.set("lon", String(center.longitude));
    params.set("radius_km", String(ARCHIVE_RADIUS_KM));
  }
  try {
    const body = await fetchJson<unknown>(`${API}/api/search?${params}`, "Search failed. Check the API and embedding model setup.");
    if (!Array.isArray(body)) throw new Error("Search returned an invalid response.");
    return { hits: body as SearchHit[], error: "" };
  } catch (error) {
    return { hits: null, error: readableError(error, "Search failed.") };
  }
}

export default function Home() {
  const [items, setItems] = useState<ArchiveArtifact[]>([]);
  const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">("checking");
  const [listError, setListError] = useState("");
  const [facets, setFacets] = useState<Facets>({ regions: [], eras: [], categories: FALLBACK_CATEGORIES });
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [view, setView] = useState<"archive" | "map">("archive");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState | null>(null);
  const [locating, setLocating] = useState(false);
  const [heroNotice, setHeroNotice] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [selectedReference, setSelectedReference] = useState<NearbyReference | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  // Each search gets a number; a slow older response must not overwrite a newer one.
  const searchRun = useRef(0);
  const searchRef = useRef<SearchState | null>(null);
  useEffect(() => { searchRef.current = search; }, [search]);
  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  const fetchItems = useCallback(async () => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    try {
      const body = await fetchJson<unknown>(`${API}/api/artifacts?${filterParams(filters)}`, "Archive API is not available.", { signal: controller.signal });
      if (!Array.isArray(body)) throw new Error("The archive API returned an invalid response.");
      setItems(body as ArchiveArtifact[]);
      setApiStatus("online");
      setListError("");
    } catch (error) {
      if (isAbortError(error)) return;
      setApiStatus("offline");
      setListError(readableError(error, "Could not load the archive."));
    } finally {
      if (listRequest.current === controller) listRequest.current = null;
    }
  }, [filters]);

  const fetchFacets = useCallback(async () => {
    try {
      const body = await fetchJson<Facets>(`${API}/api/facets`, "Facets unavailable.");
      setFacets({
        regions: Array.isArray(body.regions) ? body.regions : [],
        eras: Array.isArray(body.eras) ? body.eras : [],
        categories: Array.isArray(body.categories) && body.categories.length ? body.categories : FALLBACK_CATEGORIES,
      });
    } catch {
      // Keep the fallback category list; region and era stay "any".
    }
  }, []);

  useEffect(() => { void fetchItems(); }, [fetchItems]);
  useEffect(() => { void fetchFacets(); }, [fetchFacets]);
  useEffect(() => () => listRequest.current?.abort(), []);

  const hasPendingItems = items.some((item) => item.status === "queued" || item.status === "processing");
  useEffect(() => {
    if (!hasPendingItems) return;
    const timer = window.setInterval(() => void fetchItems(), 5000);
    return () => window.clearInterval(timer);
  }, [fetchItems, hasPendingItems]);

  async function runSearch(text: string, coordinates?: Coordinates) {
    const trimmed = text.trim();
    if (!trimmed && !coordinates) { clearSearch(); return; }
    const run = ++searchRun.current;
    const place = coordinates ? null : nearbyPlaceFromQuery(trimmed);
    const label = trimmed || "Near your location";
    setSearch({ text: trimmed, label, loading: true, center: null, references: null, referencesError: "", notice: "", hits: null, archiveError: "" });
    // Results render below the hero; bring them into view once the results bar exists.
    requestAnimationFrame(() => {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById("search-results")?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    });

    let center: NearbyCenter | null = null;
    let references: NearbyReference[] | null = null;
    let referencesError = "";
    let notice = "";
    if (place || coordinates) {
      try {
        const nearby = await fetchNearby(place, coordinates);
        center = coordinates ? { ...nearby.center, title: "your location" } : nearby.center;
        references = nearby.results;
      } catch (error) {
        if (error instanceof HttpError && error.status === 404 && place) {
          notice = `Couldn’t find “${place}” on the map, so results are ranked by meaning only.`;
        } else {
          referencesError = readableError(error, "Nearby references could not be loaded.");
          notice = "The place lookup is unavailable, so results are ranked by meaning only.";
        }
      }
    }
    const archive = await searchArchive(trimmed, center, filtersRef.current);
    if (run !== searchRun.current) return;
    setSearch({ text: trimmed, label, loading: false, center, references, referencesError, notice, hits: archive.hits, archiveError: archive.error });
  }

  function clearSearch() {
    searchRun.current += 1;
    setSearch(null);
    setQuery("");
    setHeroNotice("");
  }

  function searchNearMe() {
    setHeroNotice("");
    if (!("geolocation" in navigator)) {
      setHeroNotice("This browser cannot share its location. Type “near” and a place name instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        void runSearch(query, { latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      (error) => {
        setLocating(false);
        setHeroNotice(error.code === error.PERMISSION_DENIED
          ? "Location access was declined. Type “near” and a place name instead, e.g. “temples near Patan”."
          : "Your location could not be found just now. Try again, or type a place name.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  // Re-run the archive half of the active search when filters change; the place lookup is reused.
  useEffect(() => {
    const active = searchRef.current;
    if (!active || active.loading) return;
    const run = ++searchRun.current;
    setSearch({ ...active, loading: true });
    void searchArchive(active.text, active.center, filters).then((archive) => {
      if (run !== searchRun.current) return;
      setSearch({ ...active, loading: false, hits: archive.hits, archiveError: archive.error });
    });
  }, [filters]);

  function onUploaded(artifact: ArchiveArtifact) {
    setItems((current) => [artifact, ...current.filter((item) => item.id !== artifact.id)]);
    void fetchItems();
    void fetchFacets();
  }

  // Catalogue numbers follow accession order (oldest = No. 001). They come from the
  // unfiltered list, so a record keeps its number while filters are applied.
  const [catalogue, setCatalogue] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (Object.values(filters).some(Boolean) || items.length === 0) return;
    const ordered = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at));
    setCatalogue(new Map(ordered.map((item, index) => [item.id, index + 1])));
  }, [items, filters]);

  const openArtifact = useCallback((artifact: ArchiveArtifact) => setSelected({ artifact, pageNumber: 1 }), []);
  const highlightIds = useMemo(
    () => (search?.hits ? new Set(search.hits.map((hit) => hit.artifact.id)) : null),
    [search?.hits],
  );

  const readyCount = items.filter((item) => item.status === "ready").length;
  const placeCount = new Set(items.map((item) => item.place?.name).filter(Boolean)).size;
  const languageCount = new Set(items.map((item) => item.language).filter(Boolean)).size;
  const geoLabel = search?.center ? `within ${ARCHIVE_RADIUS_KM} km of ${search.center.title}` : "";
  const filtersActive = Object.values(filters).some(Boolean);
  const offlineExample = "stepwells near IIT Gandhinagar";

  return (
    <main className="shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <b>SthalaSutra</b>
          <span className="brand-scripts"><span lang="gu">સ્થળ</span> · <span lang="hi">स्थल</span> · place</span>
        </a>
        <nav className="side-nav" aria-label="Views">
          <button type="button" className={view === "archive" ? "active" : ""} aria-pressed={view === "archive"} onClick={() => setView("archive")}>
            Catalogue <span className="nav-count">{apiStatus === "online" ? items.length : ""}</span>
          </button>
          <button type="button" className={view === "map" ? "active" : ""} aria-pressed={view === "map"} onClick={() => setView("map")}>
            Living map
          </button>
        </nav>
        <ArchiveFilters facets={facets} filters={filters} onChange={setFilters} />
        <div className="sidebar-bottom">
          <p className={`api-status ${apiStatus}`} role="status">
            <span className="status-mark" aria-hidden />
            {apiStatus === "checking" ? "Connecting to the archive" : apiStatus === "online" ? "Archive online" : "Archive offline"}
          </p>
          <p className="sidebar-tagline">Records, inscriptions and stories, each tied to the place it describes.</p>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <p className="crumb">Collections <span aria-hidden>/</span> <b>{view === "map" ? "Living map" : "Catalogue"}</b></p>
          <button type="button" className="primary-button" onClick={() => setUploadOpen(true)}>Add a record</button>
        </header>

        <div className="content">
          <SearchHero
            query={query}
            onQueryChange={setQuery}
            onSearch={(value) => void runSearch(value)}
            onNearMe={searchNearMe}
            searching={Boolean(search?.loading)}
            locating={locating}
            notice={heroNotice}
          />

          <div className="stats-row">
            <dl className="stats">
              <div><dt>Records</dt><dd>{apiStatus === "online" ? items.length : "—"}</dd></div>
              <div><dt>Searchable</dt><dd>{apiStatus === "online" ? readyCount : "—"}</dd></div>
              <div><dt>Places</dt><dd>{apiStatus === "online" ? placeCount : "—"}</dd></div>
              <div><dt>Scripts</dt><dd>{apiStatus === "online" ? languageCount : "—"}</dd></div>
            </dl>
            <div className="view-toggle" role="group" aria-label="Show results as">
              <button type="button" aria-pressed={view === "archive"} onClick={() => setView("archive")}>List</button>
              <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}>Map</button>
            </div>
          </div>

          {search && (
            <div className="results-bar" id="search-results">
              <p>Results for <b>“{search.label}”</b>{geoLabel && <span className="results-geo"> · archive {geoLabel}</span>}</p>
              <button type="button" className="text-link" onClick={clearSearch}>Clear search</button>
            </div>
          )}
          {search?.notice && <p className="notice">{search.notice}</p>}

          {view === "map" ? (
            <div className="map-frame">
              <HeritageMap
                filters={filters}
                nearby={search?.references ?? NO_REFERENCES}
                center={search?.center ?? null}
                highlightIds={highlightIds}
                onSelect={openArtifact}
                onSelectNearby={setSelectedReference}
              />
            </div>
          ) : search ? (
            <>
              <section className="results-section" aria-labelledby="archive-results-heading" aria-busy={search.loading}>
                <header className="section-head">
                  <div>
                    <h2 id="archive-results-heading">In the archive{search.center ? ` — ${geoLabel}` : ""}</h2>
                    <p>{search.center ? "Ranked by meaning, limited by distance" : "Ranked by meaning across originals and translations"}</p>
                  </div>
                  {search.hits && <span className="section-count">{search.hits.length} {search.hits.length === 1 ? "record" : "records"}</span>}
                </header>
                {search.loading ? (
                  <div className="entry-grid">{[0, 1, 2].map((key) => <ArtifactCardSkeleton key={key} />)}</div>
                ) : search.hits === null ? (
                  <div className="index-card compact">
                    <p className="index-card-label">Archive unreachable</p>
                    <h3>The catalogue could not be searched</h3>
                    <p>{search.archiveError}</p>
                  </div>
                ) : search.hits.length === 0 ? (
                  <div className="index-card compact">
                    <p className="index-card-label">No matches</p>
                    <h3>Nothing in the archive {search.center ? geoLabel : "matches this search"}</h3>
                    <p>Try fewer words, another spelling or script, or clear the filters.</p>
                  </div>
                ) : (
                  <div className="entry-grid">
                    {search.hits.map((hit, index) => (
                      <ArtifactCard
                        key={`${hit.artifact.id}-${hit.page_number}`}
                        artifact={hit.artifact}
                        catalogueNo={catalogue.get(hit.artifact.id)}
                        snippet={hit.original_text}
                        rank={index + 1}
                        pageNumber={hit.page_number}
                        distanceKm={hit.distance_km}
                        onOpen={() => setSelected({ artifact: { ...hit.artifact, original_text: hit.original_text, translated_text: hit.translated_text }, pageNumber: hit.page_number })}
                      />
                    ))}
                  </div>
                )}
              </section>

              {search.center && search.references && (
                <NearbyResults placeName={search.center.title} references={search.references} onAsk={setSelectedReference} />
              )}
              {search.referencesError && <p className="notice">Wikipedia references are unavailable: {search.referencesError}</p>}
            </>
          ) : (
            <section className="results-section" aria-labelledby="archive-heading">
              <header className="section-head">
                <div>
                  <h2 id="archive-heading">The catalogue</h2>
                  <p>{filtersActive ? "Records matching the filters, newest first" : "Every record in the archive, newest first"}</p>
                </div>
                {apiStatus === "online" && <span className="section-count">{items.length} {items.length === 1 ? "record" : "records"}</span>}
              </header>
              {apiStatus === "checking" ? (
                <div className="entry-grid">{[0, 1, 2].map((key) => <ArtifactCardSkeleton key={key} />)}</div>
              ) : apiStatus === "offline" && items.length === 0 ? (
                <div className="index-card">
                  <p className="index-card-label">Archive offline</p>
                  <h3>The catalogue is closed for the moment</h3>
                  <p>The records are kept by the archive service, which is not answering.</p>
                  <p>
                    Place searches still work. Try{" "}
                    <button type="button" className="inline-link" onClick={() => { setQuery(offlineExample); void runSearch(offlineExample); }}>{offlineExample}</button>
                    {" "}to see public references from Wikipedia.
                  </p>
                  <p className="index-card-actions">
                    <button type="button" className="secondary-button" onClick={() => void fetchItems()}>Try again</button>
                    <span>{listError}</span>
                  </p>
                </div>
              ) : items.length === 0 ? (
                <div className="index-card">
                  <p className="index-card-label">{filtersActive ? "No matches" : "No. 001"}</p>
                  <h3>{filtersActive ? "No records match these filters" : "The first entry is yours to add"}</h3>
                  <p>{filtersActive ? "Reset the filters to see the whole catalogue." : "Upload a scan or photograph of a page — an inscription, a ledger, a letter — and it will be read, translated and placed on the map."}</p>
                  {!filtersActive && <p className="index-card-actions"><button type="button" className="primary-button" onClick={() => setUploadOpen(true)}>Add a record</button></p>}
                </div>
              ) : (
                <div className="entry-grid">
                  {items.map((item) => <ArtifactCard key={item.id} artifact={item} catalogueNo={catalogue.get(item.id)} onOpen={() => openArtifact(item)} />)}
                </div>
              )}
              {listError && items.length > 0 && <p className="notice error">{listError} Showing the records that loaded last.</p>}
            </section>
          )}
        </div>
      </section>

      {uploadOpen && <UploadModal categories={facets.categories} onClose={() => setUploadOpen(false)} onUploaded={onUploaded} />}
      {selected && (
        <ArtifactReader
          key={`${selected.artifact.id}-${selected.pageNumber}`}
          artifact={selected.artifact}
          initialPage={selected.pageNumber}
          catalogueNo={catalogue.get(selected.artifact.id)}
          onClose={() => setSelected(null)}
        />
      )}
      {selectedReference && <NearbyReferenceModal key={selectedReference.id} reference={selectedReference} onClose={() => setSelectedReference(null)} />}
    </main>
  );
}
