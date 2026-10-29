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

/** Compact five-step track shown on cards while a record is being processed. */
export default function PipelineStatus({ artifact }: PipelineStatusProps) {
  if (artifact.status === "failed") {
    return <p className="pipeline failed" role="status">Processing failed{artifact.error_message ? `: ${artifact.error_message}` : "."}</p>;
  }
  const stage = pipelineStage(artifact);
  return (
    <div className="pipeline" role="status" aria-label={`Processing: ${STAGES[stage]}`}>
      <ol className="pipeline-track" aria-hidden>
        {STAGES.map((name, index) => <li key={name} className={index < stage ? "done" : index === stage ? "current" : ""} />)}
      </ol>
      <p><b>{STAGES[stage]}</b>{artifact.progress ? ` · ${artifact.progress}` : ""}</p>
    </div>
  );
}
