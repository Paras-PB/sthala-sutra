"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Archive, ArrowDownToLine, ArrowUpRight, BookOpen, ChevronDown, Compass, FileImage, Filter, Layers3, LoaderCircle, MapPin, Search, Sparkles, UploadCloud, X } from "lucide-react";
import type { ArchiveArtifact } from "@/types/archive";

type Artifact = ArchiveArtifact;
type SearchHit = { artifact: ArchiveArtifact; original_text: string; translated_text: string | null; page_number: number; score: number };
const HeritageMap = dynamic(() => import("@/components/HeritageMap"), { ssr: false, loading: () => <div className="map-loading">Preparing map…</div> });
const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const asset = (path: string) => path.startsWith("http") ? path : `${API}${path}`;

export default function Home() {
  const [items, setItems] = useState<Artifact[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"archive" | "map">("archive");
  const [category, setCategory] = useState("");
  const [era, setEra] = useState("");
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<Artifact | null>(null);
  const [error, setError] = useState("");
  const archiveRequest = useRef<AbortController | null>(null);

  const fetchItems = useCallback(async () => {
    archiveRequest.current?.abort();
    const controller = new AbortController();
    archiveRequest.current = controller;
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (era) params.set("era", era);
    if (region) params.set("region", region);
    try {
      const res = await fetch(`${API}/api/artifacts?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error("Archive API is not available.");
      const body: unknown = await res.json();
      if (!Array.isArray(body)) throw new Error("The archive API returned an invalid response.");
      setItems(body as Artifact[]); setError("");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Could not load archive.");
    } finally {
      if (archiveRequest.current === controller) archiveRequest.current = null;
    }
  }, [category, era, region]);

  useEffect(() => { void fetchItems(); }, [fetchItems]);
  useEffect(() => () => archiveRequest.current?.abort(), []);
  const hasPendingItems = items.some(item => item.status === "queued" || item.status === "processing");
  useEffect(() => {
    if (!hasPendingItems) return;
    const timer = window.setInterval(() => void fetchItems(), 5000);
    return () => window.clearInterval(timer);
  }, [fetchItems, hasPendingItems]);

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) { setHits(null); return; }
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ q: query.trim() });
      if (category) params.set("category", category);
      if (era) params.set("era", era);
      if (region) params.set("region", region);
      const res = await fetch(`${API}/api/search?${params}`);
      if (!res.ok) throw new Error("Search failed. Check the API and embedding model setup.");
      const body: unknown = await res.json();
      if (!Array.isArray(body)) throw new Error("Search returned an invalid response.");
      setHits(body as SearchHit[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Search failed."); }
    finally { setBusy(false); }
  }

  const readyCount = items.filter(x => x.status === "ready").length;
  const stats = useMemo(() => ({ total: items.length, ready: readyCount, places: new Set(items.map(x => x.place?.name).filter(Boolean)).size }), [items, readyCount]);
  const shown: Artifact[] = hits ? hits.map(h => ({ ...h.artifact, original_text: h.original_text, translated_text: h.translated_text })) : items;

  async function submitUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const res = await fetch(`${API}/api/artifacts`, { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Upload failed.");
      setUploadOpen(false); formElement.reset(); await fetchItems();
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setBusy(false); }
  }

  return <main className="shell">
    <aside className="sidebar">
      <a className="brand" href="#"><span className="brand-mark"><Compass size={21}/></span><span><b>SthalaSutra</b><small>HERITAGE, IN PLACE</small></span></a>
      <div className="side-label">WORKSPACE</div>
      <button className={`nav-item ${view === "archive" ? "active" : ""}`} onClick={() => setView("archive")}><Archive size={17}/> Archive <span className="nav-count">{stats.total}</span></button>
      <button className={`nav-item ${view === "map" ? "active" : ""}`} onClick={() => setView("map")}><MapPin size={17}/> Living map</button>
      <div className="side-label filters-heading"><span>REFINE ARCHIVE</span><Filter size={14}/></div>
      <label className="filter-label">Region</label><div className="select-wrap"><select value={region} onChange={e => setRegion(e.target.value)}><option value="">All regions</option><option>Gujarat</option><option>Rajasthan</option><option>Madhya Pradesh</option></select><ChevronDown size={14}/></div>
      <label className="filter-label">Heritage type</label><div className="select-wrap"><select value={category} onChange={e => setCategory(e.target.value)}><option value="">All types</option><option value="stepwell">Stepwell</option><option value="fort">Fort</option><option value="craft">Craft</option><option value="temple">Temple</option><option value="other">Other</option></select><ChevronDown size={14}/></div>
      <label className="filter-label">Era</label><div className="select-wrap"><select value={era} onChange={e => setEra(e.target.value)}><option value="">Any era</option><option value="medieval">Medieval</option><option value="19th">19th century</option><option value="modern">Modern</option></select><ChevronDown size={14}/></div>
      <div className="sidebar-bottom"><div className="local-badge"><span className="pulse"/> LIVE ARCHIVE</div><p>Stories, sources, and places gathered in one searchable atlas.</p><small>STHALASUTRA · MVP 0.1</small></div>
    </aside>

    <section className="main-panel">
      <header className="topbar"><div className="crumb">COLLECTIONS <span>/</span> <b>{view === "map" ? "LIVING MAP" : "ALL HERITAGE"}</b></div><button className="upload-btn" onClick={() => setUploadOpen(true)}><UploadCloud size={16}/> Add to archive</button></header>
      <div className="content">
        <div className="eyebrow"><span className="eyebrow-line"/> A FIELD GUIDE FOR THE PAST</div>
        <div className="hero-row"><div><h1>Every place keeps<br/><em>a story.</em></h1><p className="intro">A living archive of monuments, memories, and the people who keep them.</p></div><div className="hero-stamp"><Sparkles size={15}/><span>DISCOVER<br/>WHAT'S HERE</span></div></div>

        <div className="search-box"><Search size={19}/><form onSubmit={runSearch}><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Ask the archive: ‘stepwells near Ahmedabad’"/><button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <ArrowUpRight size={18}/>}</button></form></div>
        <div className="search-hint"><Sparkles size={13}/> Search across original scripts, translations, and place stories</div>

        <div className="stats-row"><div><strong>{stats.total.toString().padStart(2,"0")}</strong><span>ARCHIVE ITEMS</span></div><i/><div><strong>{stats.ready.toString().padStart(2,"0")}</strong><span>SEARCHABLE</span></div><i/><div><strong>{stats.places.toString().padStart(2,"0")}</strong><span>PLACES MAPPED</span></div><div className="view-toggle"><button className={view === "archive" ? "selected" : ""} onClick={() => setView("archive")}><Layers3 size={15}/> Archive</button><button className={view === "map" ? "selected" : ""} onClick={() => setView("map")}><MapPin size={15}/> Map</button></div></div>
        {error && <div className="error-banner">{error}</div>}
        {hits && <div className="results-label"><span>SEARCH RESULTS</span><button onClick={() => { setHits(null); setQuery(""); }}>Clear search <X size={13}/></button></div>}

        {view === "map" ? <div className="map-frame"><HeritageMap api={API} filters={{region,category,era}} onSelect={setSelected}/></div> : <>
          <div className="section-head"><div><h2>{hits ? "Found in the archive" : "The gathered archive"}</h2><p>{hits ? `${shown.length} passages, ranked by meaning` : "Field notes and records, ready to explore"}</p></div><span className="count-chip">{shown.length} RECORDS <ChevronDown size={12}/></span></div>
          {shown.length === 0 ? <div className="empty-state"><BookOpen size={25}/><b>{error ? "Archive connection unavailable" : hits ? "No matching passages yet" : "Your archive is ready to grow"}</b><span>{error ? "Start the backend services and reload." : "Upload a page or image to begin building this collection."}</span></div> : <div className="artifact-grid">{shown.map(item => <article className="artifact-card" key={item.id} onClick={() => setSelected(item)}>
            <div className="card-image"><img src={asset(item.image_url)} alt={item.title}/><span className="image-index">{String(shown.indexOf(item)+1).padStart(2,"0")}</span><span className="image-corner"><ArrowUpRight size={16}/></span>{item.status !== "ready" && <span className={`status-tag ${item.status}`}><i/>{item.status}</span>}</div>
            <div className="card-body"><div className="card-kicker">{item.category.toUpperCase()} <span>·</span> {item.era || "UNDATED"}</div><h3>{item.title}</h3><div className="card-place"><MapPin size={13}/>{item.place?.name || (item.latitude && item.longitude ? `${item.latitude.toFixed(2)}, ${item.longitude.toFixed(2)}` : "Location not set")}<span>{item.place?.region}</span></div>
              {item.original_text ? <p className="snippet">{item.original_text.slice(0,140)}{item.original_text.length > 140 ? "…" : ""}</p> : <p className="snippet muted">{item.status === "processing" ? "Reading this record and preparing it for search…" : item.status === "failed" ? item.error_message : "OCR text will appear here once processing completes."}</p>}
              <div className="card-foot"><span><FileImage size={13}/>{item.media_type.includes("pdf") ? "PDF DOCUMENT" : "FIELD IMAGE"}</span><span>{item.language || "LANGUAGE PENDING"}</span></div></div>
          </article>)}</div>}
          <div className="archive-note"><span/><span>END OF CURRENT COLLECTION</span><span/></div>
        </>}
      </div>
    </section>

    {uploadOpen && <div className="modal-backdrop" onMouseDown={e => { if(e.target===e.currentTarget)setUploadOpen(false); }}><form className="upload-modal" onSubmit={submitUpload}><button type="button" className="modal-close" onClick={() => setUploadOpen(false)}><X size={18}/></button><div className="eyebrow"><span className="eyebrow-line"/> ADD A SOURCE</div><h2>Bring a story<br/><em>into the archive.</em></h2><label className="dropzone"><UploadCloud size={24}/><strong>Choose a scan, photograph, or PDF</strong><span>JPG, PNG, WEBP or PDF · up to 25 MB</span><input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required/></label><label>Title<input name="title" placeholder="e.g. Inscription at Adalaj stepwell"/></label><div className="form-pair"><label>Type<select name="category"><option value="other">Other</option><option value="stepwell">Stepwell</option><option value="fort">Fort</option><option value="craft">Craft</option><option value="temple">Temple</option></select></label><label>Era<input name="era" placeholder="e.g. 15th century"/></label></div><label>Place name<input name="place_name" placeholder="e.g. Adalaj stepwell"/></label><label>Region<input name="region" placeholder="e.g. Gujarat"/></label><div className="form-pair"><label>Latitude<input name="latitude" type="number" step="any" placeholder="23.22"/></label><label>Longitude<input name="longitude" type="number" step="any" placeholder="72.58"/></label></div><button className="modal-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <ArrowDownToLine size={16}/>} Upload &amp; process</button><p className="privacy-note">The original file is preserved. OCR and indexing run as a background task.</p></form></div>}

    {selected && <div className="modal-backdrop" onMouseDown={e => {if(e.target===e.currentTarget)setSelected(null);}}><div className="detail-modal"><button type="button" className="modal-close" onClick={() => setSelected(null)}><X size={18}/></button><div className="detail-image"><img src={asset(selected.image_url)} alt={selected.title}/></div><div className="detail-content"><div className="eyebrow"><span className="eyebrow-line"/> ARCHIVE RECORD · {selected.category.toUpperCase()}</div><h2>{selected.title}</h2><p className="detail-place"><MapPin size={14}/>{selected.place?.name || "Location not recorded"}{selected.place?.region && ` · ${selected.place.region}`}</p><div className="transcript"><label>ORIGINAL TRANSCRIPTION</label><p>{selected.original_text || (selected.status === "failed" ? selected.error_message : "Processing is underway. This record will appear here when OCR completes.")}</p></div>{selected.translated_text && <div className="transcript translation"><label>ENGLISH TRANSLATION</label><p>{selected.translated_text}</p></div>}<div className="detail-meta"><span>{selected.era || "Era unknown"}</span><span>{selected.language || "Language pending"}</span><a href={asset(selected.image_url)} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={13}/></a></div></div></div></div>}
  </main>;
}
