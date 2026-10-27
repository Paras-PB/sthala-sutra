# SthalaSutra

**Heritage, connected to its place.** SthalaSutra is a searchable, map-aware archive for heritage records: scans and photographs stay linked to their OCR transcription, English translation, metadata, and geographic context.

## What works in this MVP

- Upload PDF, JPEG, PNG, or WebP files with optional place, region, and coordinates.
- Process uploads asynchronously with Celery and Redis. Tesseract OCR supports English, Hindi, and Gujarati; PDFs are read page by page.
- Translate Hindi and Gujarati to English with a local NLLB-200 model. English transcription is retained as-is.
- Generate multilingual 384-dimensional embeddings and search passages with pgvector cosine similarity.
- Browse and filter by region, category, and era; view monuments, route geometries, and folklore records on a MapLibre map using OpenStreetMap tiles.
- Inspect the source image, original transcription, and translation together.

## Architecture

```mermaid
flowchart LR
  W[Next.js + MapLibre web app] -->|upload, browse, search| API[FastAPI]
  API --> DB[(Supabase Postgres<br/>PostGIS + pgvector)]
  API --> Q[(Redis queue)]
  Q --> CW[Celery worker]
  CW --> OCR[Tesseract / Poppler]
  CW --> MT[NLLB translation]
  CW --> EMB[Multilingual sentence transformer]
  CW --> DB
  CW --> FS[(Uploaded source files)]
  API --> FS
  DB -->|PostGIS spatial records| MAP[Monuments · Routes · Folklore]
```

The local one-command setup runs Postgres with PostGIS/pgvector, Redis, the API, worker, and frontend in Compose. Hosted setup uses Supabase Postgres for the database and deploys the Next.js frontend to Vercel. The API/worker remain a Docker service because OCR and embedding models need a persistent worker process and filesystem; point the Vercel frontend at that service with `NEXT_PUBLIC_API_URL`.

## Repository structure

```text
frontend/                  Next.js archive, search, upload, and map UI
backend/app/               FastAPI routes, SQLAlchemy models, Celery jobs, seed script
ml/                        OCR, translation, metadata, and embedding adapters
infra/                     Compose stack and PostGIS + pgvector database image
supabase/migrations/       versioned Supabase schema migration
data/                      generated sample archive notes
scripts/demo.ps1           short video walkthrough
```

## Database schema

- `places`: heritage place name, region, and optional `geometry(Point, 4326)` point.
- `artifacts`: original file identity and storage path, category, era, language, processing state, coordinates, and optional place.
- `passages`: per-page OCR transcription, optional English translation, extracted entity JSON, and `vector(384)` embedding.
- `map_features`: typed monument/route/folklore records with PostGIS geometry and a link to a source artifact.

Indexes cover place and feature geometry (GiST), passage vectors (HNSW cosine), artifact relationships, and creation time. RLS is enabled on all four Supabase tables. No roles are granted Data API access; the API connects server-side with the database owner credential and never exposes it in the browser. Both migrations were applied to Supabase project `SthalaSutra` (`aeqoautluushbwpyrpnc`).

## Run locally

Requirements: Docker Desktop with Compose.

```powershell
docker compose -f infra/docker-compose.yml up --build
docker compose -f infra/docker-compose.yml exec api python -m app.seed
```

Open http://localhost:3000. API docs are at http://localhost:8000/docs. The first OCR/search job downloads the multilingual sentence-transformer model; the first Hindi or Gujarati translation downloads NLLB-200 (about 2.5 GB). Sample pages and route/folklore map layers are synthetic demonstration fixtures, labeled as such and not historical source material. Seed is repeatable and skips existing sample records.

To use the Supabase database instead of Compose Postgres, copy `.env.example` to `.env` and set `DATABASE_URL` to your Supabase PostgreSQL connection URL. Use the project's Session Pooler for the long-lived API/worker. Keep the password in backend/Vercel server environment variables; never prefix it with `NEXT_PUBLIC_` or commit it. The schema migrations are in `supabase/migrations/` and match the versions recorded in Supabase.

## Vercel deployment

1. Import this GitHub repository into Vercel and set the project root to `frontend/` (Next.js is detected automatically).
2. Add `NEXT_PUBLIC_API_URL` with the public HTTPS base URL for the FastAPI service, then deploy the frontend.
3. Deploy `backend/Dockerfile` twice on a container host: one service with the default Uvicorn command and one with `celery -A app.worker.celery_app worker --loglevel=INFO --concurrency=1`. Give both `DATABASE_URL`, `CELERY_BROKER_URL`, and `UPLOAD_DIR`; mount the same persistent upload volume for API and worker. Set `CORS_ORIGINS` to the Vercel site origin. Keep one worker process per container for the local NLLB model; scale by adding worker containers.
4. Configure a Redis-compatible broker and set `TRANSLATION_MODEL=facebook/nllb-200-distilled-600M` (or a compatible alternative) and `EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` on the worker.

The frontend is Vercel-ready. OCR/translation/embedding jobs are not run inside Vercel Functions; deploy the API and Celery worker as persistent container services. Uploaded files currently use a shared persistent filesystem; Supabase Storage support is a deployment follow-up before scaling beyond a single worker volume. NLLB-200 is licensed CC-BY-NC 4.0, so review the model terms before commercial use.

## 2–3 minute demo

Run `scripts/demo.ps1` or follow the same flow:

1. Start Compose and seed the three sample notes.
2. Search `stepwell near Ahmedabad`; open an item to show original OCR text and English translation.
3. Filter by region/type/era, switch to the living map, and open a geotagged pin.
4. Upload a scan or photo with a place and coordinates. Show the queued → processing → ready state, then search the extracted passage.

## Limitations and next steps

- OCR accuracy depends on scan quality and Tesseract language packs. Handwriting and complex page layouts need a stronger document model and review UI.
- NLLB model weights are large, and translation should be checked by a human before academic citation.
- Metadata extraction is transparent and rule-based; entity confidence and editor correction are planned.
- Uploaded files use a shared volume; switch to Supabase Storage/object storage for multi-instance deployment.
- Next: user auth and curator roles, audit/provenance history, route/folklore entities, deduplication, evaluation fixtures, and production observability.
