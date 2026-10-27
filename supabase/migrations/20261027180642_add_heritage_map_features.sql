CREATE TABLE public.map_features (
  id uuid PRIMARY KEY,
  title varchar(240) NOT NULL,
  feature_type varchar(24) NOT NULL CHECK (feature_type IN ('monument', 'route', 'folklore')),
  region varchar(160),
  description text NOT NULL,
  geom extensions.geometry(Geometry, 4326) NOT NULL,
  artifact_id uuid REFERENCES public.artifacts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_map_features_geom ON public.map_features USING GIST (geom);
CREATE INDEX ix_map_features_artifact_id ON public.map_features(artifact_id);
ALTER TABLE public.map_features ENABLE ROW LEVEL SECURITY;
