import ArtifactPreview from "@/components/ArtifactPreview";
import PipelineStatus from "@/components/PipelineStatus";
import { catalogueNumber, formatKilometers, languageName, placeLabel } from "@/lib/archive-client";
import type { ArchiveArtifact } from "@/types/archive";

type ArtifactCardProps = {
  artifact: ArchiveArtifact;
  /** Position in the catalogue (oldest record = 1), when known. */
  catalogueNo?: number;
  /** Passage to show instead of the first page (search hits). */
  snippet?: string | null;
  /** 1-based rank, only for ranked search results. */
  rank?: number;
  pageNumber?: number;
  distanceKm?: number | null;
  onOpen: () => void;
};

/** One catalogue entry: number, image plate with caption, title, metadata line, excerpt. */
export default function ArtifactCard({ artifact, catalogueNo, snippet, rank, pageNumber, distanceKm, onOpen }: ArtifactCardProps) {
  const place = placeLabel(artifact);
  const text = snippet ?? artifact.original_text ?? artifact.translated_text;
  const language = languageName(artifact.language);
  const caption = [
    place ? `${place}${artifact.place?.region ? `, ${artifact.place.region}` : ""}` : "Location not recorded",
    distanceKm !== undefined && distanceKm !== null ? `${formatKilometers(distanceKm)} away` : null,
  ].filter(Boolean).join(" · ");
  const folio = artifact.page_count > 1
    ? pageNumber !== undefined ? `Folio ${pageNumber}/${artifact.page_count}` : `${artifact.page_count} folios`
    : null;
  const meta = [artifact.category, artifact.era, language, folio].filter(Boolean).join(" · ");

  return (
    <article className="entry">
      <p className="entry-head">
        <span>{catalogueNo !== undefined ? catalogueNumber(catalogueNo) : "No. —"}</span>
        {rank !== undefined && <span className="entry-rank">Match {String(rank).padStart(2, "0")}</span>}
      </p>
      <figure className="plate">
        <ArtifactPreview artifact={artifact} />
        <figcaption>{caption}</figcaption>
      </figure>
      <h3>
        {/* The button's ::after stretches over the whole entry, so the entry is one keyboard stop. */}
        <button type="button" className="card-link" onClick={onOpen}>{artifact.title}</button>
      </h3>
      <p className="entry-meta">{meta}</p>
      {artifact.status !== "ready"
        ? <PipelineStatus artifact={artifact} />
        : text
          ? <p className="snippet" lang={artifact.language ?? undefined}>{text.slice(0, 180)}{text.length > 180 ? "…" : ""}</p>
          : <p className="snippet empty">No text was found on this page.</p>}
    </article>
  );
}

export function ArtifactCardSkeleton() {
  return (
    <div className="entry skeleton" aria-hidden>
      <span className="shimmer line short" />
      <span className="plate shimmer" />
      <span className="shimmer line title" />
      <span className="shimmer line" />
      <span className="shimmer line" />
    </div>
  );
}
