# Architecture notes

This document explains the design decisions behind ingestion, search, the schema and security. The [README](../README.md) covers setup and the API surface. File references are to the repository root.

## Components

| Process | Code | Responsibility |
| --- | --- | --- |
| `api` | `backend/app/main.py` | Validates uploads, stores files, enqueues jobs, serves search, map and detail reads, and serves `/uploads`. Also loads the embedding model to embed search queries. |
| `worker` | `backend/app/worker.py`, `backend/app/pipeline.py`, `ml/pipeline.py` | Runs one ingestion job at a time (`--concurrency=1`, `worker_prefetch_multiplier=1`). |
| `db` | `infra/db/Dockerfile` | Postgres 16 with PostGIS 3.6 and pgvector. |
| `redis` | `compose.yaml` | Celery broker, with append-only persistence so queued jobs survive a restart. |
| `web` | `frontend/` | Next.js UI plus three server route handlers: the archive proxy (`/api/archive/*`), the Wikipedia nearby lookup (`/api/nearby`) and the heritage guide (`/api/heritage-guide`). |

Task results are not stored (`task_ignore_result=True`). The `artifacts` row is the only record of job state, and the UI polls it.

## Ingestion pipeline

### Upload (`POST /api/artifacts`)

The handler is a plain `def`, so FastAPI runs it in a thread pool and the blocking file write and database calls do not stall the event loop. Checks run in this order, cheapest first:

1. The declared content type must be JPEG, PNG, WebP or PDF (415).
2. Latitude and longitude must be given together and be in range (422).
3. At most `MAX_UPLOAD_BYTES + 1` bytes are read, so an oversized body is rejected without reading all of it (413).
4. The first bytes must match the declared type's file signature (`FF D8 FF`, the PNG header, `RIFF....WEBP`, `%PDF-`) (415).
5. The filename is reduced to its last path component (Windows separators included), stripped of line breaks and truncated; its extension must match the content type (415).
6. Category must be one of the fixed set; title, era, region and place name are length-checked (422).

The file is stored as `<uuid><ext>`; the user-supplied name is only kept as metadata, so it never becomes a path. The artifact row is committed with `status = queued` before enqueueing. If enqueueing fails, the row is marked failed with "The processing queue is unavailable". If the database insert fails, the stored file is deleted.

Place creation uses `INSERT … ON CONFLICT (name) DO NOTHING` followed by a select, so two concurrent uploads naming the same new place do not fail on the unique constraint.

### Processing (`run_pipeline`)

1. Set `status = processing`, `progress = "Starting"`, commit. Read the list of known place names, then commit again to end the read transaction before the slow work begins.
2. `ocr_document` counts pages (PDFs over 100 pages are rejected) and renders them one at a time at 180 DPI, so a long PDF does not hold every page in memory. Images over 40 megapixels are rejected as decompression bombs.
3. The first page is saved as a JPEG preview (longest edge at most 1600 px, never enlarged) before OCR starts, so the UI can show a thumbnail of a PDF while it is still being read.
4. Each page is read with `tesseract -l eng+hin+guj --psm 6`. If the result contains at least six Gujarati or Devanagari characters, the page is read again with only that script's model, on the original image and on a grayscale, auto-contrast, 2× enlarged copy; the output with the most characters from that script wins. The combined model often confuses Devanagari and Gujarati letterforms, which is why the second pass exists.
5. Script detection decides the page language (`gu`, `hi` or `en`). Hindi and Gujarati pages are translated with NLLB-200 (`hin_Deva` / `guj_Gujr` to `eng_Latn`) in chunks of at most 1200 characters, eight chunks per batch, so long pages are not truncated at the model's input length.
6. Entities are extracted from the original plus translation:
   - **Dates**: Gujarati (૦–૯) and Devanagari (०–९) digits are first normalised to ASCII, so `૧૪૯૯માં` yields `1499`. The pattern accepts centuries ("11th century"), years with era markers ("2400 BCE") and bare years 1000–2099. It uses lookarounds instead of `\b`, because a year glued to a Gujarati suffix has no word boundary.
   - **Places**: names already in the `places` table, matched case-insensitively as whole words. "Adalaj Stepwell" also matches "Adalaj" (a generic last word and a leading word of five or more letters), while "Rani ki Vav" does not match every "Rani".
   - **Type**: a keyword list in Latin, Gujarati and Devanagari script; Indic keywords match as substrings because suffixes attach directly (`વાવનું`, `મંદિરમાં`).
7. Each page is embedded: the text is split into chunks of at most 700 characters, each chunk is embedded with L2 normalisation, and the vectors are averaged and normalised again.
8. In one transaction: delete the artifact's old passages, insert the new ones, set `language` to the most common page language (ties go to the first page seen), fill `era`, `category` and `place` only if the uploader left them empty or `other`, set `preview_path`, clear `progress`, set `status = ready`.

### Progress and transaction design

Progress lines ("Reading page 2 of 5", "Translating page 2 of 5", "Indexing page 2 of 5", "Saving search index") are written by `_set_progress` in a separate session and committed immediately, so a polling client sees them while the main transaction is still open. Two properties make this safe:

- `_set_progress` issues a column-level `UPDATE` of `progress` (and `preview_path` on page 1). It never touches passages.
- The main session never assigns `progress` until the final commit, so its flush cannot overwrite a newer progress value with a stale one.

All model work happens before any passage is deleted. A failure during OCR, translation or embedding therefore leaves the previous passages searchable; only the final short transaction replaces them.

### Failure handling

| Failure | What happens | What the user sees |
| --- | --- | --- |
| Problem with the file (`ProcessingError`: unreadable or encrypted PDF, over 100 pages, image over 40 MP, not an image, no text detected, empty embedding) | Logged as a warning, row marked `failed`, no retry (`ProcessingError` is a `ValueError`). | The specific message, for example "No readable text was detected in this file." |
| Missing source file (`FileNotFoundError`) or any other `ValueError` | Logged with traceback, marked `failed`, no retry. | "Processing failed because of an internal error. Try uploading again." |
| Any other exception (database blip, model download failure) | Logged with traceback. Retried up to 3 times after 2, 4 and 8 seconds (capped at 300). Between attempts the row is set back to `queued` with "Processing failed; retry N is scheduled." | The retry notice, then either `ready` or the generic internal-error message. |
| Worker child killed mid-task (for example by the out-of-memory killer) | `task_acks_late=True` with `task_reject_on_worker_lost=False` acknowledges the message instead of requeueing it, so one oversized file cannot be redelivered forever and block the single-worker queue. A `task_failure` signal receiver in the parent process sees the `WorkerLostError`, marks the row `failed` and disposes the connection pool so forked replacement children do not inherit its connections. | "The worker ran out of resources while processing this file." |

Driver and library exception text can include SQL, file paths or connection details, so it goes to logs only. Only `ProcessingError` messages, which are written for users, reach the `error_message` column.

## Search

### Candidate retrieval

`search_candidates_statement` in `backend/app/main.py` builds one query:

- `ORDER BY passages.embedding <=> :query_vector` (cosine distance) with `LIMIT limit × 5`, served by the HNSW index.
- Region and era as case-insensitive substring filters, category as an exact filter.
- With `lat`/`lon`: the record's point is its own coordinates if present, otherwise its place's point (`COALESCE(ST_SetSRID(ST_MakePoint(lon, lat), 4326), places.geom)`), cast to `geography` so distances are metres on the spheroid. `ST_DWithin(point, query_point, radius_km × 1000)` filters, and `ST_Distance / 1000` is returned as `distance_km`.

pgvector's HNSW scan returns at most `hnsw.ef_search` rows (default 40). With filters or a radius applied after the index scan, that cap can silently empty the result set. The handler runs `set_config('hnsw.ef_search', max(40, limit × 5), true)` before the query; the `true` scopes it to the current transaction.

### Reranking

`backend/app/search.py` is pure Python with no database access, which is why it is unit-tested directly.

```
score = 0.8 × (1 − cosine_distance) + 0.2 × lexical
lexical = matched_terms / query_terms
```

Query terms are the distinct casefolded words of three or more characters, stripped of ASCII punctuation plus the Devanagari danda and typographic quotes and dashes, minus a short English stopword list ("near", "the", "of" and so on).

Matching is a substring test against the casefolded original and translated text, not tokenisation. Two reasons:

- Gujarati and Devanagari vowel signs (matras such as `ા`, `ી`, `ે`) are combining marks, not regex word characters, so `\w+` tokenisation splits words in the middle and `\b` boundaries fall in the wrong places.
- Substring matching gives cheap stemming in English ("stepwell" matches "stepwells").

The cost is occasional false positives for short terms that appear inside longer words. The three-character minimum and the 0.2 weight keep that small next to the semantic score.

After scoring, only the best passage per artifact is kept, and the list is sorted by score. Python's sort is stable, so ties keep the database's distance order. The response includes both `score` and `semantic_score` so a client can show why a record ranked where it did.

### Geo search in the web app

The API takes coordinates. Resolving "near IIT Gandhinagar" or "Near me" to coordinates is the web app's job (Wikipedia page coordinates or the browser's geolocation). The separate `/api/nearby` route handler queries Wikipedia's geosearch within 10 km of a page and filters the results to heritage landmarks by title, category and summary patterns; those results are displayed as references and never written to the archive.

## Schema and migration parity

There are two ways a schema is created:

- **Development** (`AUTO_CREATE_SCHEMA` true, the default unless `APP_ENV` is `production`): `initialize_database` creates the `vector` and `postgis` extensions, runs `Base.metadata.create_all`, enables RLS on the four tables, and adds `progress` and `preview_path` with `ADD COLUMN IF NOT EXISTS`. That last step exists because `create_all` never alters an existing table, so an older local volume would otherwise miss the new columns.
- **Production**: no DDL at startup. `_verify_migrated_schema` checks that the four tables and both extensions exist and that `artifacts` has `progress` and `preview_path`. If anything is missing it raises with the name of the migration to apply, and the API does not start. DDL on every replica start risks lock contention and needs privileges the runtime role should not have.

The SQLAlchemy models name their indexes and constraints exactly as the migrations do. `backend/tests/test_api_schema.py` compiles the models to PostgreSQL DDL and asserts that the indexes, constraints and the new columns match, and that the geometry columns do not get a second, automatically named spatial index from GeoAlchemy. Any schema change needs both a migration and a model change, or this test fails.

The migration `20261029120000_add_artifact_progress_and_preview.sql` uses `ADD COLUMN IF NOT EXISTS`, so it is safe on a database that a development build has already upgraded.

## Security choices

- **No public Data API access.** RLS is enabled on every table with no policies, and `20261027182827_restrict_archive_data_api_access.sql` revokes all table privileges from Supabase's `anon`, `authenticated` and `service_role` roles, including default privileges for future tables and sequences. The archive is only reachable through the FastAPI server's own connection.
- **Database credentials stay server-side.** `DATABASE_URL` is passed only to the `api` and `worker` containers. The `web` container receives `HERITAGE_API_URL`, `GOOGLE_GENERATIVE_AI_API_KEY` and `HOSTNAME`, nothing else. No database value is ever exposed through a `NEXT_PUBLIC_*` variable.
- **Gemini key stays server-side.** The guide runs in a Next.js route handler, so the key never reaches the browser.
- **Upload validation** checks content type, magic bytes, extension, size, page count and pixel count, and never uses the supplied filename as a path. See [Upload](#upload-post-apiartifacts).
- **Error-message hygiene.** Users see `ProcessingError` messages and fixed strings; exception text from drivers and libraries is logged only. The Next.js proxy and guide also return fixed error codes and messages rather than upstream error bodies.
- **Proxy surface.** The archive proxy forwards only `accept`, `content-type`, `range` and `if-none-match` request headers and a short list of response headers, does not follow redirects, enforces the 25 MB limit itself and times out after 60 seconds.
- **Guide prompt handling.** The system prompt treats record and Wikipedia text as untrusted evidence rather than instructions, and the route validates the artifact id as a UUID and the reference id as `wikipedia:<digits>` before fetching anything. It is rate limited to 10 questions per 10 minutes per client address, in memory.
- **Containers.** The backend image runs as an unprivileged `app` user. Postgres and Redis bind to `127.0.0.1` on the host.
- **CORS** allows only `CORS_ORIGINS`, without credentials. It matters only when `NEXT_PUBLIC_API_URL` makes the browser call the API directly.

### Known gaps

- There is no authentication or authorisation. Anyone who can reach the API can upload and read everything.
- `/uploads` serves every stored file to anyone with its UUID-based name.
- There is no malware scanning of uploads beyond type and signature checks.
- The guide's rate limit is per web instance and resets on restart.
