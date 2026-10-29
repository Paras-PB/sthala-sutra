"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import ArtifactPreview from "@/components/ArtifactPreview";
import HeritageGuide from "@/components/HeritageGuide";
import Modal from "@/components/Modal";
import PipelineStatus from "@/components/PipelineStatus";
import { API, assetUrl, catalogueNumber, languageName, placeLabel, titleCase } from "@/lib/archive-client";
import { fetchJson, isAbortError } from "@/lib/http";
import type { ArchiveArtifact, ArchiveArtifactDetail, ArchivePage } from "@/types/archive";

type ArtifactReaderProps = {
  artifact: ArchiveArtifact;
  /** Page to open on, e.g. the page a search hit came from. */
  initialPage?: number;
  catalogueNo?: number;
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

function firstLine(text: string): string | null {
  const line = text.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  if (!line) return null;
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
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

export default function ArtifactReader({ artifact, initialPage = 1, catalogueNo, onClose }: ArtifactReaderProps) {
  const [detail, setDetail] = useState<ArchiveArtifactDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [fallbackCitation, setFallbackCitation] = useState("");

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
  // The opening words in the original script, set large under the English title.
  const incipit = record.language && record.language !== "en" ? firstLine(page.original_text) : null;

  async function copyCitation() {
    const citation = buildCitation(record);
    try {
      await navigator.clipboard.writeText(citation);
      setCopyState("copied");
      setFallbackCitation("");
      window.setTimeout(() => setCopyState("idle"), 2500);
    } catch {
      // Clipboard access can be refused (insecure origin, embedded frame); show the text to copy by hand.
      setCopyState("failed");
      setFallbackCitation(citation);
    }
  }

  return (
    <Modal labelledBy="reader-title" onClose={onClose} className="reader-modal">
      <div className="reader">
        <aside className="reader-source">
          <div className="reader-sticky">
            <figure className="plate">
              <ArtifactPreview artifact={record} className="reader-image" />
              <figcaption>
                <span>{record.original_filename}</span>
                {pages.length > 1 && <span>Folio {page.page_number}/{pages.length}</span>}
              </figcaption>
            </figure>
            <a className="text-link" href={assetUrl(record.image_url)} target="_blank" rel="noreferrer">
              Open the original file <ArrowUpRight size={13} aria-hidden />
            </a>
          </div>
        </aside>

        <div className="reader-body">
          <p className="modal-kicker">
            {catalogueNo !== undefined ? `${catalogueNumber(catalogueNo)} · ` : ""}{titleCase(record.category)}
          </p>
          <h2 id="reader-title">{record.title}</h2>
          {incipit && <p className="incipit" lang={record.language ?? undefined}>{incipit}</p>}

          <dl className="record-facts">
            <div><dt>Place</dt><dd>{place ? `${place}${record.place?.region ? `, ${record.place.region}` : ""}` : "Not recorded"}</dd></div>
            <div><dt>Era</dt><dd>{record.era || "Not recorded"}</dd></div>
            <div><dt>Script</dt><dd>{language ?? "Not yet detected"}</dd></div>
            <div><dt>Folios</dt><dd>{Math.max(record.page_count, pages.length)}</dd></div>
          </dl>

          {record.status !== "ready" && <PipelineStatus artifact={record} />}

          {pages.length > 1 && (
            <nav className="folio-switcher" aria-label="Folios">
              <button type="button" disabled={pageIndex <= 0} onClick={() => setPageNumber(pages[pageIndex - 1].page_number)}>
                <ChevronLeft size={15} aria-hidden /> Previous
              </button>
              <span aria-live="polite">Folio {page.page_number} of {pages.length}</span>
              <button type="button" disabled={pageIndex >= pages.length - 1} onClick={() => setPageNumber(pages[pageIndex + 1].page_number)}>
                Next <ChevronRight size={15} aria-hidden />
              </button>
            </nav>
          )}

          <div className="parallel-text">
            <section aria-labelledby="original-label">
              <h3 id="original-label">Original{language ? `, ${language}` : ""}</h3>
              {page.original_text
                ? <p className="script-text" lang={record.language ?? undefined}>{page.original_text}</p>
                : <p className="text-empty">{record.status === "ready" ? "No text was found on this folio." : "The transcription appears here once reading finishes."}</p>}
            </section>
            <section aria-labelledby="translation-label">
              <h3 id="translation-label">English translation</h3>
              {page.translated_text
                ? <p lang="en">{page.translated_text}</p>
                : <p className="text-empty">{record.language === "en" ? "This folio is already in English." : "No translation yet."}</p>}
            </section>
          </div>
          {loadingDetail && <p className="loading-note"><span className="shimmer line" aria-hidden /> Loading every folio…</p>}

          {hasEntities && (
            <section className="entities" aria-labelledby="entities-label">
              <h3 id="entities-label">Named on this folio</h3>
              <dl className="record-facts">
                {entities.dates.length > 0 && <div><dt>Dates</dt><dd>{entities.dates.join("; ")}</dd></div>}
                {entities.places.length > 0 && <div><dt>Places</dt><dd>{entities.places.join("; ")}</dd></div>}
                {entities.category && <div><dt>Type</dt><dd>{titleCase(entities.category)}</dd></div>}
              </dl>
            </section>
          )}

          <div className="reader-actions">
            <button type="button" className="secondary-button" onClick={() => void copyCitation()}>
              {copyState === "copied" ? "Citation copied" : "Copy citation"}
            </button>
            <span className="copy-status" role="status">{copyState === "failed" ? "This browser blocked copying. Select the citation below." : ""}</span>
            <code className="record-id" title="Record id">{record.id}</code>
          </div>
          {fallbackCitation && <p className="citation-fallback">{fallbackCitation}</p>}

          <HeritageGuide key={record.id} kind="archive" targetId={record.id} title={record.title} />
        </div>
      </div>
    </Modal>
  );
}
