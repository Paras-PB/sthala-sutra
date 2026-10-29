Sample archive images are generated reproducibly by `python -m app.seed` inside the API container (`docker compose exec api python -m app.seed`). They are labeled synthetic sample field notes, not source scans or scholarly transcriptions.

The set covers Gujarat heritage around IIT Gandhinagar and Ahmedabad. Three samples are written in Gujarati or Hindi (Devanagari) script so the demo can show native-script OCR, English translation and cross-lingual search; they are rendered with Noto fonts and Raqm text shaping so Tesseract can read them.
