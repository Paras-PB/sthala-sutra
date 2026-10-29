import type { FormEvent } from "react";
import { ArrowRight, LoaderCircle, LocateFixed } from "lucide-react";

const SPECIMEN_QUERY = "રાણીની વાવ";

const SUGGESTED_QUERIES = [
  "stepwells near IIT Gandhinagar",
  "Solanki-era temples",
  SPECIMEN_QUERY,
  "weaving traditions of Gujarat",
];

const STEPS = [
  { name: "Scan", detail: "Photograph or upload a page, a plaque, a ledger." },
  { name: "Read", detail: "OCR transcribes Gujarati, Hindi and English script." },
  { name: "Translate", detail: "Each folio is rendered into English beside the original." },
  { name: "Search & map", detail: "Find it again by meaning, by place, or on the map." },
];

type SearchHeroProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: (value: string) => void;
  onNearMe: () => void;
  searching: boolean;
  locating: boolean;
  /** Shown under the search box, e.g. a declined location permission. */
  notice: string;
};

const isGujarati = (value: string) => /\p{Script=Gujarati}/u.test(value);

export default function SearchHero({ query, onQueryChange, onSearch, onNearMe, searching, locating, notice }: SearchHeroProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(query);
  }

  function runSuggestion(value: string) {
    onQueryChange(value);
    onSearch(value);
  }

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <h1 id="hero-title">Every place keeps a story.</h1>
        <p className="hero-lede">
          A field archive of inscriptions, records and stories. Scan a page in Gujarati, Hindi or English;
          read the original beside its translation; search the archive by meaning, place, or script.
        </p>
      </div>

      <figure className="specimen">
        <p className="specimen-label">Specimen query</p>
        <p className="specimen-script" lang="gu">{SPECIMEN_QUERY}</p>
        <figcaption>
          <span className="specimen-gloss">Rani ki Vav, the Queen’s stepwell at Patan</span>
          <button type="button" className="text-link" onClick={() => runSuggestion(SPECIMEN_QUERY)}>
            Search in Gujarati, match records in any script <ArrowRight size={13} aria-hidden />
          </button>
        </figcaption>
      </figure>

      <form className="search-box" role="search" onSubmit={submit}>
        <label htmlFor="archive-search" className="visually-hidden">Search the archive</label>
        <input
          id="archive-search"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search by meaning, place, or script — e.g. temples near Patan"
          autoComplete="off"
        />
        <button type="button" className="near-me" onClick={onNearMe} disabled={locating} aria-label="Search near my location">
          {locating ? <LoaderCircle className="spin" size={15} aria-hidden /> : <LocateFixed size={15} aria-hidden />}
          <span>Near me</span>
        </button>
        <button type="submit" className="search-submit" disabled={searching}>
          {searching ? <LoaderCircle className="spin" size={15} aria-hidden /> : null}
          Search
        </button>
      </form>
      {notice && <p className="search-notice" role="status">{notice}</p>}

      <div className="suggestions">
        <span className="suggestions-label">Try</span>
        <ul>
          {SUGGESTED_QUERIES.map((suggestion) => (
            <li key={suggestion}>
              <button type="button" lang={isGujarati(suggestion) ? "gu" : undefined} onClick={() => runSuggestion(suggestion)}>
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ol className="steps" aria-label="How a record moves through the archive">
        {STEPS.map((step, index) => (
          <li key={step.name}>
            <span className="step-number" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
            <b>{step.name}</b>
            <span className="step-detail">{step.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
