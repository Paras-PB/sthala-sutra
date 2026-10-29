"use client";

import { useState } from "react";
import { previewImage } from "@/lib/archive-client";
import type { ArchiveArtifact } from "@/types/archive";

type ArtifactPreviewProps = {
  artifact: ArchiveArtifact;
  className?: string;
};

/**
 * Shows the rendered preview (PDFs get one from the backend), the image itself, or a
 * ruled document placeholder — never a broken <img> for a PDF.
 */
export default function ArtifactPreview({ artifact, className = "" }: ArtifactPreviewProps) {
  const source = previewImage(artifact);
  const [failedSource, setFailedSource] = useState<string | null>(null);

  if (source && failedSource !== source) {
    return <img className={`artifact-preview ${className}`} src={source} alt={`Scan of ${artifact.title}`} loading="lazy" onError={() => setFailedSource(source)} />;
  }

  const isPdf = artifact.media_type.includes("pdf");
  return (
    <div className={`artifact-preview placeholder ${className}`} role="img" aria-label={`${isPdf ? "PDF document" : "Image"}: ${artifact.title}`}>
      <span className="placeholder-format">{isPdf ? "PDF" : "IMG"}</span>
      <span className="placeholder-note">{isPdf ? "Preview not yet rendered" : "Preview unavailable"}</span>
    </div>
  );
}
