"use client";

import { useState, type DragEvent, type FormEvent } from "react";
import { FileText, LoaderCircle, UploadCloud } from "lucide-react";
import Modal from "@/components/Modal";
import { ACCEPTED_UPLOAD_TYPES, API, MAX_UPLOAD_BYTES, formatFileSize, titleCase } from "@/lib/archive-client";
import { fetchJson, readableError } from "@/lib/http";
import type { ArchiveArtifact } from "@/types/archive";

type UploadModalProps = {
  categories: string[];
  onClose: () => void;
  onUploaded: (artifact: ArchiveArtifact) => void;
};

/** Mirrors the backend's checks so obvious mistakes fail before a 25 MB upload starts. */
function fileProblem(file: File): string | null {
  if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) return `“${file.name}” is not a JPG, PNG, WebP or PDF file.`;
  if (file.size > MAX_UPLOAD_BYTES) return `“${file.name}” is ${formatFileSize(file.size)}; the limit is 25 MB.`;
  if (file.size === 0) return `“${file.name}” is empty.`;
  return null;
}

export default function UploadModal({ categories, onClose, onUploaded }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function chooseFile(next: File | undefined) {
    if (!next) return;
    const problem = fileProblem(next);
    setError(problem ?? "");
    setFile(problem ? null : next);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { setError("Choose a scan, photograph or PDF first."); return; }
    const form = new FormData(event.currentTarget);
    // The file comes from state so drag-and-drop and the picker behave the same.
    form.set("file", file);
    setBusy(true);
    setError("");
    try {
      const artifact = await fetchJson<ArchiveArtifact>(`${API}/api/artifacts`, "Upload failed.", { method: "POST", body: form });
      onUploaded(artifact);
      onClose();
    } catch (cause) {
      setError(readableError(cause, "Upload failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy="upload-title" onClose={onClose} className="upload-modal">
      <form onSubmit={submit} noValidate>
        <p className="modal-kicker">Add a source</p>
        <h2 id="upload-title">Bring a record into the archive</h2>
        <p className="modal-lede">Upload a scan in Gujarati, Hindi or English. It is read, translated and indexed in the background.</p>

        <label
          className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {file ? <>
            <FileText size={24} aria-hidden />
            <strong>{file.name}</strong>
            <span>{formatFileSize(file.size)} · {file.type === "application/pdf" ? "PDF" : file.type.replace("image/", "").toUpperCase()} · choose again to replace</span>
          </> : <>
            <UploadCloud size={24} aria-hidden />
            <strong>Drop a file here, or choose one</strong>
            <span>JPG, PNG, WebP or PDF, up to 25 MB</span>
          </>}
          <input name="file" type="file" accept={ACCEPTED_UPLOAD_TYPES.join(",")} aria-label="Scan, photograph or PDF" onChange={(event) => chooseFile(event.target.files?.[0])} />
        </label>

        <label className="field">Title<input name="title" placeholder="Inscription at Adalaj stepwell" maxLength={300} /></label>
        <div className="form-pair">
          <label className="field">Type
            <select name="category" defaultValue="other">
              {(categories.includes("other") ? categories : [...categories, "other"]).map((category) => <option key={category} value={category}>{titleCase(category)}</option>)}
            </select>
          </label>
          <label className="field">Era<input name="era" placeholder="15th century" maxLength={120} /></label>
        </div>
        <div className="form-pair">
          <label className="field">Place name<input name="place_name" placeholder="Adalaj stepwell" maxLength={240} /></label>
          <label className="field">Region<input name="region" placeholder="Gujarat" maxLength={160} /></label>
        </div>
        <div className="form-pair">
          <label className="field">Latitude<input name="latitude" type="number" step="any" min={-90} max={90} placeholder="23.17" /></label>
          <label className="field">Longitude<input name="longitude" type="number" step="any" min={-180} max={180} placeholder="72.58" /></label>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button wide" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={16} aria-hidden /> : <UploadCloud size={16} aria-hidden />}
          {busy ? "Uploading…" : "Upload and process"}
        </button>
        <p className="fine-print">The original file is kept unchanged. Large files may need direct API mode when hosted on Vercel.</p>
      </form>
    </Modal>
  );
}
