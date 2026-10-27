-- The archive is accessed through the FastAPI server's PostgreSQL connection,
-- not through Supabase's browser-facing Data API. Revoke the default API-role
-- table grants so RLS is backed by least-privilege object access as well.
REVOKE ALL PRIVILEGES ON TABLE
  public.places,
  public.artifacts,
  public.passages,
  public.map_features
FROM anon, authenticated, service_role;

-- Keep future archive tables private by default for objects created by postgres.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
