export type ArchiveArtifact = {
  id: string;
  title: string;
  original_filename: string;
  media_type: string;
  category: string;
  era: string | null;
  language: string | null;
  status: string;
  error_message: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  place: { name: string; region: string | null } | null;
  original_text: string | null;
  translated_text: string | null;
  image_url: string;
};
