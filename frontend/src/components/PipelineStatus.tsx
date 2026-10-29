import type { ArchiveArtifact } from "@/types/archive";

const STAGES = ["Queued", "Reading", "Translating", "Indexing", "Ready"] as const;

/**
 * Maps the backend's status + free-text progress to one of five stages.
 * The progress wording is not a fixed enum, so this matches on keywords.
 */
export function pipelineStage(artifact: Pick<ArchiveArtifact, "status" | "progress">): number {
  if (artifact.status === "ready") return 4;
  if (artifact.status === "queued") return 0;
  const progress = artifact.progress?.toLowerCase() ?? "";
  if (/index|embed|vector/.test(progress)) return 3;
  if (/translat/.test(progress)) return 2;
  return 1;
}

type PipelineStatusProps = { artifact: ArchiveArtifact };

/** A quiet ledger line: finished stages in ink, the current one in rust, the rest faint. */
export default function PipelineStatus({ artifact }: PipelineStatusProps) {
  if (artifact.status === "failed") {
    return (
      <div className="ledger failed" role="status">
        <p className="ledger-stages">Processing stopped</p>
        <p className="ledger-note">{artifact.error_message || "The pipeline could not finish this record."}</p>
      </div>
    );
  }
  const stage = pipelineStage(artifact);
  return (
    <div className="ledger" role="status" aria-label={`Processing: ${STAGES[stage]}${artifact.progress ? `, ${artifact.progress}` : ""}`}>
      <ol className="ledger-stages" aria-hidden>
        {STAGES.map((name, index) => <li key={name} className={index < stage ? "done" : index === stage ? "current" : ""}>{name}</li>)}
      </ol>
      {artifact.progress && <p className="ledger-note" aria-hidden>{artifact.progress}</p>}
    </div>
  );
}
