"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Copy, MapPin } from "lucide-react";
import ArtifactPreview from "@/components/ArtifactPreview";
import HeritageGuide from "@/components/HeritageGuide";
import Modal from "@/components/Modal";
import PipelineStatus from "@/components/PipelineStatus";
import { API, assetUrl, languageName, placeLabel, titleCase } from "@/lib/archive-client";
import { fetchJson, isAbortError } from "@/lib/http";
import type { ArchiveArtifact, ArchiveArtifactDetail, ArchivePage } from "@/types/archive";

type ArtifactReaderProps = {
  artifact: ArchiveArtifact;
  /** Page to open on, e.g. the page a search hit came from. */
  initialPage?: number;
  onClose: () => void;
};

/** Until the detail arrives, the list item's own text stands in as page one. */
function fallbackPage(artifact: ArchiveArtifact, pageNumber: number): ArchivePage {
  return {
    page_number: pageNumber,
    original_text: artifact.original_text ?? "",
    translated_text: artifact.translated_text,
    entities: { places: [], dates: [], category: null },
  };
}

function buildCitation(artifact: ArchiveArtifact): string {
  const place = [artifact.place?.name, artifact.place?.region].filter(Boolean).join(", ");
  const accessed = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const source = new URL(assetUrl(artifact.image_url), window.location.href).toString();
  const parts = [
    artifact.title.replace(/\.+$/, ""),
    place || "Place not recorded",
    artifact.era || "Undated",
    `SthalaSutra heritage archive, record ${artifact.id}`,
    source,
    `Accessed ${accessed}`,
  ];
  return `${parts.join(". ")}.`;
}

export default function ArtifactReader({ artifact, initialPage = 1, onClose }: ArtifactReaderProps) {
  const [detail, setDetail] = useState<ArchiveArtifactDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<ArchiveArtifactDetail>(`${API}/api/artifacts/${artifact.id}`, "Could not load this record.", { signal: controller.signal })
      .then((value) => setDetail(value))
      .catch((error: unknown) => { if (!isAbortError(error)) setDetailError(true); });
    return () => controller.abort();
  }, [artifact.id]);

  const record = detail ?? artifact;
  const pages = detail?.pages?.length ? detail.pages : [fallbackPage(artifact, initialPage)];
  const page = pages.find((item) => item.page_number === pageNumber) ?? pages[0];
  const pageIndex = pages.indexOf(page);
  const language = languageName(record.language);
  const place = placeLabel(record);
  // Older records may lack entity extraction; treat missing lists as empty.
  const entities = {
    places: page.entities?.places ?? [],
    dates: page.entities?.dates ?? [],
    category: page.entities?.category ?? null,
  };
  const hasEntities = entities.dates.length > 0 || entities.places.length > 0 || Boolean(entities.category);
  const loadingDetail = !detail && !detailError;

  async function copyCitation() {
    try {
      await navigator.clipboard.writeText(buildCitation(record));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 2500);
  }

  return (
    <Modal labelledBy="reader-title" onClose={onClose} className="reader-modal">
      <div className="reader">
        <aside className="reader-source">
          <ArtifactPreview artifact={record} className="reader-image" />
          <a className="text-link" href={assetUrl(record.image_url)} target="_blank" rel="noreferrer">
            Open original file <ArrowUpRight size={13} aria-hidden />
          </a>
        </aside>

        <div className="reader-body">
          <p className="modal-kicker">Archive record · {titleCase(record.category)}</p>
          <h2 id="reader-title">{record.title}</h2>
          <p className="reader-meta">
            {place && <span><MapPin size={14} aria-hidden />{place}{record.place?.region ? `, ${record.place.region}` : ""}</span>}
            <span>{record.era || "Era not recorded"}</span>
            {language && <span className="lang-badge">{language}</span>}
          </p>

          {record.status !== "ready" && <PipelineStatus artifact={record} />}

          {pages.length > 1 && (
            <nav className="page-switcher" aria-label="Pages">
              <button type="button" aria-label="Previous page" disabled={pageIndex <= 0} onClick={() => setPageNumber(pages[pageIndex - 1].page_number)}><ChevronLeft size={16} aria-hidden /></button>
              <span aria-live="polite">Page {page.page_number} of {pages.length}</span>
              <button type="button" aria-label="Next page" disabled={pageIndex >= pages.length - 1} onClick={() => setPageNumber(pages[pageIndex + 1].page_number)}><ChevronRight size={16} aria-hidden /></button>
            </nav>
          )}

          <div className="parallel-text">
            <section aria-labelledby="original-label">
              <h3 id="original-label">Original{language ? ` (${language})` : ""}</h3>
              {page.original_text
                ? <p className="script-text" lang={record.language ?? undefined}>{page.original_text}</p>
                : <p className="text-empty">{record.status === "ready" ? "No text was found on this page." : "The transcription appears here once reading finishes."}</p>}
            </section>
            <section aria-labelledby="translation-label">
              <h3 id="translation-label">English translation</h3>
              {page.translated_text
                ? <p lang="en">{page.translated_text}</p>
                : <p className="text-empty">{record.language === "en" ? "This page is already in English." : "No translation yet."}</p>}
            </section>
          </div>
          {loadingDetail && <p className="loading-note"><span className="shimmer line" aria-hidden /> Loading all pages…</p>}

          {hasEntities && (
            <div className="entities" aria-label="Found on this page">
              {entities.category && <span className="chip category">{titleCase(entities.category)}</span>}
              {entities.dates.map((date) => <span key={`d-${date}`} className="chip date">{date}</span>)}
              {entities.places.map((name) => <span key={`p-${name}`} className="chip place"><MapPin size={11} aria-hidden />{name}</span>)}
            </div>
          )}

          <div className="reader-actions">
            <button type="button" className="secondary-button" onClick={() => void copyCitation()}>
              {copyState === "copied" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              {copyState === "copied" ? "Citation copied" : "Copy citation"}
            </button>
            <span className="copy-status" role="status">{copyState === "failed" ? "Copying is blocked in this browser. Select the record details instead." : ""}</span>
            <code className="record-id" title="Record id">{record.id.slice(0, 8)}</code>
          </div>

          <HeritageGuide key={record.id} kind="archive" targetId={record.id} title={record.title} />
        </div>
      </div>
    </Modal>
  );
}
