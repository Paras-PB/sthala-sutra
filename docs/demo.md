# Demo script

A three-minute walkthrough of SthalaSutra on the seeded sample data. `scripts/demo.ps1` prints the same steps in a terminal.

## Pre-demo checklist

Do this at least 15 minutes before presenting.

- [ ] `docker compose up --build` from the repository root, and wait until `docker compose ps` shows `api`, `worker` and `web` as healthy.
- [ ] Run the seed once: `docker compose exec api python -m app.seed`. This downloads the embedding model and NLLB-200 (about 2.5 GB) into the `modelcache` volume and processes all 11 samples. Wait until every card in the archive shows as ready; the Gujarati and Hindi notes take longest.
- [ ] Run one search in the UI (any query). The API process loads the embedding model on its first search, which can take several seconds; do it now, not on stage.
- [ ] `GOOGLE_GENERATIVE_AI_API_KEY` is set in `.env` and the web container was recreated afterwards (`docker compose up -d web`). Ask the guide one question to confirm it answers.
- [ ] Have an upload file ready. To reuse a sample image: `docker compose cp api:/app/sample-data/field-note-9.png ./demo-upload.png` (the Gujarati Adalaj note). Any clean printed scan or PDF works too.
- [ ] Browser at 100% zoom (or 110% for a projector), one tab on http://localhost:3000, notifications muted. If you will use "Near me", allow location access for localhost beforehand.
- [ ] Fallback if Wikipedia is slow or unreachable: place resolution for "near …" depends on the Wikipedia API. Use "Near me" instead, or search `stepwells` with the region filter set to Gujarat, or show the radius search directly at http://localhost:8000/docs with `GET /api/search?q=stepwell&lat=23.2156&lon=72.6842&radius_km=25`.

## Walkthrough (about 3 minutes)

| Time | Do | Say | The viewer should notice |
| --- | --- | --- | --- |
| 0:00 | Open the archive view. | "Heritage records arrive as scans in different scripts; this archive makes them searchable and puts them on the map." | Cards for English, Gujarati and Hindi notes, each labelled as a synthetic sample. |
| 0:20 | Search `stepwells near IIT Gandhinagar`. | "The place is resolved through Wikipedia, then the archive is searched by meaning within a radius of it." | Stepwell records around Adalaj and Ahmedabad, each with a distance in km; Rani ki Vav in Patan is outside the radius. |
| 0:50 | Search `રાણીની વાવ` (Gujarati script). | "A query in Gujarati finds the same monument described in Hindi and English." | Rani ki Vav notes in other scripts appear among the results. |
| 1:10 | Search `Solanki-era temples`. | "Ranking is mostly semantic, with a small boost for literal term matches." | Modhera temple notes appear even though one calls the dynasty "Chaulukya" and another writes it in Gujarati. |
| 1:30 | Open *Adalaj ni Vav · Gujarati sample field note*. | "Every record keeps the source image, the OCR text in its original script and an English translation side by side." | Gujarati text beside its translation; extracted date 1499 (from ૧૪૯૯) and the detected place; the copy-citation control. |
| 1:55 | Ask the guide: "Who built this stepwell, and when?" | "The guide answers only from this record and a matching Wikipedia article, and lists its sources." | The answer names its sources, and caveats OCR and translation errors where relevant. |
| 2:15 | Switch to the Living map. | "Records, routes and folklore pins are stored as PostGIS geometry." | The sample water-heritage trail from Ahmedabad to Patan and the Rudabai legend pin at Adalaj. |
| 2:35 | Upload `demo-upload.png` with a place and coordinates. | "New uploads are validated, queued and processed in the background." | The card moves from queued to processing with per-page progress ("Reading page 1 of 1", "Translating page 1 of 1") and then to ready. |
| 2:55 | Close. | "Everything runs locally on CPU in Docker; the docs list the limits honestly." | |

The upload step can take longer than 20 seconds for a Gujarati or Hindi page on CPU. If time is short, show the progress line and move on; the card becomes ready in the background.

## Reset

`docker compose down -v` deletes the database, uploads and model cache. Use plain `docker compose down` between rehearsals to keep the downloaded models.
