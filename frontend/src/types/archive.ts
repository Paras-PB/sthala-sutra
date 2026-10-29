import type { Geometry } from "geojson";

// Shapes returned by the FastAPI archive backend (through /api/archive) and by
// this app's own /api/nearby route. Keep them in step with backend/app/schemas.py.

export type ArtifactStatus = "queued" | "processing" | "ready" | "failed";

/** ISO 639-1 codes the OCR pipeline detects. */
export type ArchiveLanguage = "en" | "hi" | "gu";

export type ArchivePlace = {
  id: string;
  name: string;
  region: string | null;
};

export type ArchiveArtifact = {
  id: string;
  title: string;
  original_filename: string;
  media_type: string;
  category: string;
  era: string | null;
  language: ArchiveLanguage | null;
  status: ArtifactStatus;
  /** Human-readable pipeline step while processing, e.g. "Translating page 3 of 12". */
  progress: string | null;
  error_message: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  place: ArchivePlace | null;
  /** Text of the first page (or the matched passage when it comes from search). */
  original_text: string | null;
  translated_text: string | null;
  page_count: number;
  image_url: string;
  preview_url: string | null;
};

export type PageEntities = {
  places: string[];
  dates: string[];
  category: string | null;
};

export type ArchivePage = {
  page_number: number;
  original_text: string;
  translated_text: string | null;
  entities: PageEntities;
};

export type ArchiveArtifactDetail = ArchiveArtifact & { pages: ArchivePage[] };

export type SearchHit = {
  artifact: ArchiveArtifact;
  original_text: string;
  translated_text: string | null;
  page_number: number;
  score: number;
  semantic_score: number;
  distance_km: number | null;
};

export type Facets = {
  regions: string[];
  eras: string[];
  categories: string[];
};

export type ArchiveFilters = {
  region: string;
  category: string;
  era: string;
};

export type MapArtifactPoint = {
  latitude: number;
  longitude: number;
  artifact: ArchiveArtifact;
};

export type MapFeatureKind = "monument" | "route" | "folklore";

export type MapFeature = {
  id: string;
  title: string;
  kind: MapFeatureKind;
  description: string;
  geometry: Geometry;
  artifact: ArchiveArtifact | null;
};

export type MapData = {
  artifacts: MapArtifactPoint[];
  features: MapFeature[];
};

export type NearbyReference = {
  id: string;
  title: string;
  description: string;
  image_url: string | null;
  latitude: number;
  longitude: number;
  distance_meters: number;
  article_url: string;
  source: string;
  categories: string[];
};

export type NearbyCenter = {
  title: string;
  latitude: number;
  longitude: number;
};

export type NearbyResponse = {
  near: string;
  center: NearbyCenter;
  radius_meters: number;
  source: string;
  results: NearbyReference[];
};
