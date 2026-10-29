import { MapPin } from "lucide-react";
import ArtifactPreview from "@/components/ArtifactPreview";
import PipelineStatus from "@/components/PipelineStatus";
import { formatKilometers, languageName, placeLabel, titleCase } from "@/lib/archive-client";
import type { ArchiveArtifact } from "@/types/archive";

type ArtifactCardProps = {
  artifact: ArchiveArtifact;
  /** Passage to show instead of the first page (search hits). */
  snippet?: string | null;
  /** 1-based rank, only for ranked search results. */
  rank?: number;
  pageNumber?: number;
  distanceKm?: number | null;
  onOpen: () => void;
};

export default function ArtifactCard({ artifact, snippet, rank, pageNumber, distanceKm, onOpen }: ArtifactCardProps) {
  const place = placeLabel(artifact);
  const text = snippet ?? artifact.original_text ?? artifact.translated_text;
  const language = languageName(artifact.language);
  const processing = artifact.status !== "ready";

  return (
    <article className="artifact-card">
      <div className="card-media">
        <ArtifactPreview artifact={artifact} />
        {rank !== undefined && <span className="card-rank" aria-label={`Rank ${rank}`}>{rank}</span>}
        {distanceKm !== undefined && distanceKm !== null && <span className="distance-chip">{formatKilometers(distanceKm)} away</span>}
      </div>
      <div className="card-body">
        <p className="card-kicker">{titleCase(artifact.category)}{artifact.era ? `, ${artifact.era}` : ""}</p>
        <h3>
          {/* The button's ::after stretches over the whole card, so the card is one keyboard stop. */}
          <button type="button" className="card-link" onClick={onOpen}>{artifact.title}</button>
        </h3>
        <p className="card-place">
          <MapPin size={13} aria-hidden />
          <span>{place ?? "Location not set"}</span>
          {artifact.place?.region && <span className="card-region">{artifact.place.region}</span>}
        </p>
        {processing
          ? <PipelineStatus artifact={artifact} />
          : <p className="snippet" lang={artifact.language ?? undefined}>{text ? text.slice(0, 160) + (text.length > 160 ? "…" : "") : "No text was found on this page."}</p>}
        <p className="card-foot">
          {language && <span className="lang-badge">{language}</span>}
          {pageNumber !== undefined && artifact.page_count > 1 && <span>Page {pageNumber} of {artifact.page_count}</span>}
          {pageNumber === undefined && artifact.page_count > 1 && <span>{artifact.page_count} pages</span>}
          <span className="card-format">{artifact.media_type.includes("pdf") ? "PDF" : "Image"}</span>
        </p>
      </div>
    </article>
  );
}

export function ArtifactCardSkeleton() {
  return (
    <div className="artifact-card skeleton" aria-hidden>
      <div className="card-media shimmer" />
      <div className="card-body">
        <span className="shimmer line short" />
        <span className="shimmer line title" />
        <span className="shimmer line" />
        <span className="shimmer line" />
      </div>
    </div>
  );
}
