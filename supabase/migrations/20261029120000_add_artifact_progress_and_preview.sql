-- Processing progress text (e.g. "OCR page 2 of 5") and a rendered preview
-- image path for PDFs, both written by the ingestion worker.
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS progress varchar(120);
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS preview_path varchar(1024);
