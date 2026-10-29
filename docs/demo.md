# Demo script

A three-minute walkthrough of SthalaSutra on the seeded sample data. `scripts/demo.ps1` prints the same steps in a terminal. Labels in quotes are the exact text of the controls in the UI.

## Pre-demo checklist

Do this at least 15 minutes before presenting.

- [ ] `docker compose up --build` from the repository root, and wait until `docker compose ps` shows `api`, `worker` and `web` as healthy.
- [ ] Run the seed once: `docker compose exec api python -m app.seed`. This downloads the embedding model and NLLB-200 (about 2.5 GB) into the `modelcache` volume and processes all 11 samples. Wait until no card shows the processing ledger (Queued, Reading, Translating, Indexing) and the "Searchable" count equals "Records"; the Gujarati and Hindi notes take longest.
- [ ] Run one search (click any query under "Try"). The API process loads the embedding model on its first search, which can take several seconds; do it now, not on stage.
- [ ] `GOOGLE_GENERATIVE_AI_API_KEY` is set in `.env` and the web container was recreated afterwards (`docker compose up -d web`). Open a record and click one suggested question under "Ask the heritage guide" to confirm it answers. Without a key the guide shows "The guide is off on this server".
- [ ] Have an upload file ready. To reuse a sample image: `docker compose cp api:/app/sample-data/field-note-9.png ./demo-upload.png` (the Gujarati Adalaj note). Any clean printed scan or PDF works too.
- [ ] Browser at 100% zoom (or 110% for a projector), one tab on http://localhost:3000, notifications muted. If you will use "Near me", allow location access for localhost beforehand; if it is declined, the page says so and suggests typing a place.
- [ ] Fallback if Wikipedia is slow or unreachable: the place lookup for "near …" depends on the Wikipedia API. If it fails, the page shows "The place lookup is unavailable, so results are ranked by meaning only" and still lists archive matches. To show the radius search anyway, open http://localhost:8000/docs and run `GET /api/search?q=stepwell&lat=23.2156&lon=72.6842&radius_km=25`.

## Walkthrough (about 3 minutes)

| Time | Do | Say | The viewer should notice |
| --- | --- | --- | --- |
| 0:00 | Open the "Catalogue" view. | "Heritage records arrive as scans in different scripts; this archive makes them searchable and ties each one to its place." | Numbered cards for English, Gujarati and Hindi notes, each titled as a sample field note. |
| 0:20 | Under "Try", click `stepwells near IIT Gandhinagar`. | "The place is found on Wikipedia, then the archive is searched by meaning within 25 km of it." | The results bar reads "within 25 km of Indian Institute of Technology Gandhinagar"; Adalaj and Dada Harir cards show a distance; "Nearby public references" from Wikipedia follow below. |
| 0:50 | Click the Gujarati specimen card's link, "Search in Gujarati, match records in any script". | "A query in Gujarati finds the same monument described in Hindi and English." | Rani ki Vav notes in Devanagari and English among the matches. |
| 1:10 | Click `Solanki-era temples` under "Try". | "Ranking is mostly semantic, with a small boost for literal term matches." | Modhera notes appear even though one calls the dynasty "Chaulukya" and another writes it in Gujarati. |
| 1:30 | Click "Clear search" and open *Adalaj ni Vav · Gujarati sample field note*. | "Every record keeps the source image, the original script and an English translation side by side." | The opening line in Gujarati under the title, "Original, Gujarati" beside "English translation", 1499 under "Named on this folio". Click "Copy citation". |
| 1:55 | In "Ask the heritage guide", click "Which people, places and dates does it mention?". | "The guide answers only from this record and one matching Wikipedia article, and lists its sources." | The answer and its numbered sources. |
| 2:15 | Close the reader (Escape) and click "Living map". | "Records, routes and folklore pins are stored as PostGIS geometry." | The legend, the sample water-heritage trail from Ahmedabad to Patan, and the Rudabai legend pin at Adalaj; hover a pin for its label. |
| 2:35 | Click "Add a record", drop `demo-upload.png` on the drop zone, fill in a place, latitude and longitude, and click "Add to the archive". | "Uploads are validated, then read, translated and indexed in the background." | The new card's ledger moves from Queued to Reading and Translating, with the progress line underneath ("Reading page 1 of 1"). |
| 2:55 | Close. | "Everything runs locally on CPU in Docker, and the docs list the limits." | |

On the map, a search run beforehand dims the records outside the results and adds a marker for the searched place; use this if there is time. For a multi-page PDF the reader shows a folio switcher ("Previous", "Folio 1 of N", "Next"); the seeded samples are single pages, so it does not appear for them.

The upload can take longer than 20 seconds for a Gujarati or Hindi page on CPU. If time is short, show the ledger and move on; the card reaches Ready in the background.

## Reset

`docker compose down -v` deletes the database, uploads and model cache. Use plain `docker compose down` between rehearsals to keep the downloaded models.
