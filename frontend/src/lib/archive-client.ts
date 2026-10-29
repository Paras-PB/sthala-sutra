import type { ArchiveArtifact, ArchiveFilters, ArchiveLanguage } from "@/types/archive";

// Browser-side helpers for talking to the archive and formatting its data.

/** Either a direct backend URL (NEXT_PUBLIC_API_URL) or this app's proxy route. */
export const API = (process.env.NEXT_PUBLIC_API_URL || "/api/archive").replace(/\/$/, "");

export const FALLBACK_CATEGORIES = ["stepwell", "fort", "craft", "temple", "other"];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const ARCHIVE_RADIUS_KM = 25;

/** Backend file paths ("/uploads/x.jpg") become URLs the browser can load. */
export function assetUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${API}${path}`;
}

/** The best image to show for a record, or null when only a PDF placeholder fits. */
export function previewImage(artifact: ArchiveArtifact): string | null {
  if (artifact.preview_url) return assetUrl(artifact.preview_url);
  if (artifact.media_type.startsWith("image/")) return assetUrl(artifact.image_url);
  return null;
}

export function filterParams(filters: ArchiveFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.region) params.set("region", filters.region);
  if (filters.category) params.set("category", filters.category);
  if (filters.era) params.set("era", filters.era);
  return params;
}

const LANGUAGE_NAMES: Record<ArchiveLanguage, string> = { en: "English", hi: "Hindi", gu: "Gujarati" };

export function languageName(code: string | null): string | null {
  if (!code) return null;
  return LANGUAGE_NAMES[code as ArchiveLanguage] ?? code.toUpperCase();
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatMeters(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function formatKilometers(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Place name, else coordinates, else null. Uses null checks so 0° is a valid coordinate. */
export function placeLabel(artifact: ArchiveArtifact): string | null {
  if (artifact.place?.name) return artifact.place.name;
  if (artifact.latitude !== null && artifact.longitude !== null) {
    return `${artifact.latitude.toFixed(2)}, ${artifact.longitude.toFixed(2)}`;
  }
  return null;
}

/** "stepwells near IIT Gandhinagar" → "IIT Gandhinagar". */
export function nearbyPlaceFromQuery(value: string): string | null {
  const match = value.trim().match(/\bnear\s+([^,;.!?]+?)[.!?]*$/i);
  return match?.[1]?.trim().replace(/\s+/g, " ") || null;
}
