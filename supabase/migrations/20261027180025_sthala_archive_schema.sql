-- SthalaSutra archive schema. RLS is enabled on every public table; the
-- application connects through the server-side postgres role, while public
-- Data API access has no grants or policies.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TABLE public.places (
  id uuid PRIMARY KEY,
  name varchar(240) NOT NULL UNIQUE,
  region varchar(160),
  geom extensions.geometry(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.artifacts (
  id uuid PRIMARY KEY,
  title varchar(300) NOT NULL,
  original_filename varchar(512) NOT NULL,
  storage_path varchar(1024) NOT NULL,
  media_type varchar(120) NOT NULL,
  category varchar(80) NOT NULL DEFAULT 'other',
  era varchar(120),
  language varchar(40),
  status varchar(24) NOT NULL DEFAULT 'queued',
  error_message text,
  place_id uuid REFERENCES public.places(id) ON DELETE SET NULL,
  latitude double precision,
  longitude double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT artifacts_valid_latitude CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT artifacts_valid_longitude CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE public.passages (
  id uuid PRIMARY KEY,
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  page_number integer NOT NULL DEFAULT 1,
  original_text text NOT NULL,
  translated_text text,
  entities jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding extensions.vector(384)
);

CREATE INDEX ix_artifacts_place_id ON public.artifacts(place_id);
CREATE INDEX ix_artifacts_created_at ON public.artifacts(created_at DESC);
CREATE INDEX ix_passages_artifact_id ON public.passages(artifact_id);
CREATE INDEX ix_places_geom ON public.places USING GIST (geom);
CREATE INDEX ix_passages_embedding ON public.passages USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passages ENABLE ROW LEVEL SECURITY;
