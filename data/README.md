# Sample data

The seed script (`backend/app/seed.py`) generates a small synthetic archive so the stack can be tried without real source material:

```bash
docker compose exec api python -m app.seed
```

Everything it creates is written for demonstration. The text is short, plausible prose about Gujarat heritage sites, not a transcription of any real document, and must not be cited.

## Field notes (11)

Each note is rendered as a 1350 × 900 PNG "scan" with a header and footer that read `STHALASUTRA · SAMPLE ARCHIVE` and `SYNTHETIC FIELD NOTE · FOR OCR AND SEARCH DEMONSTRATION`, and every title is labelled as a sample field note. The images are then processed by the normal pipeline (OCR, translation, embedding), so they exercise the same code path as a real upload.

| Script | Notes |
| --- | --- |
| English (8) | Adalaj Stepwell, Rani ki Vav, Kutch weaving (Bhuj), Modhera Sun Temple, Dada Harir Stepwell, Sidi Saiyyed Mosque jali, Patan Patola weaving, Lothal dockyard |
| Gujarati (2) | Adalaj ni Vav, Modhera Surya Mandir |
| Hindi, Devanagari (1) | Rani ki Vav |

The Gujarati and Hindi notes describe the same sites as English notes, so they demonstrate native-script OCR, translation and cross-lingual search. They are rendered with Noto Sans Gujarati and Noto Sans Devanagari through Pillow's Raqm layout engine; without Raqm the conjuncts and vowel signs are not shaped and Tesseract cannot read the result, so the seed prints a warning in that case.

## Map features (4)

Two routes (a stepwell study route and a water-heritage trail from Ahmedabad to Patan) and two folklore pins (a Kutch oral-history pin and a Rudabai legend pin at Adalaj), each linked to a sample note.

## Files

Generated PNGs are written to `SAMPLE_DIR` (`/app/sample-data` in the API container; `data/sample/` when run outside Docker, ignored by git) and copied into the upload volume. Re-running the seed skips records that already exist.
