import type { FormEvent } from "react";
import { ArrowRight, LoaderCircle, LocateFixed, Search } from "lucide-react";

const SUGGESTED_QUERIES = [
  "stepwells near IIT Gandhinagar",
  "Solanki-era temples",
  "રાણીની વાવ",
  "weaving traditions of Gujarat",
];

const STEPS = [
  { name: "Scan", detail: "Upload a photo or PDF of any page." },
  { name: "Read", detail: "OCR transcribes Gujarati, Hindi and English." },
  { name: "Translate", detail: "Every page gets an English translation." },
  { name: "Search & map", detail: "Find records by meaning, near a place, or on the map." },
];

type SearchHeroProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: (value: string) => void;
  onNearMe: () => void;
  searching: boolean;
  locating: boolean;
  /** Shown under the search box, e.g. a denied location permission. */
  notice: string;
};

export default function SearchHero({ query, onQueryChange, onSearch, onNearMe, searching, locating, notice }: SearchHeroProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(query);
  }

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <h1 id="hero-title">Every place keeps a story.</h1>
        <p className="hero-lede">
          Scan a page in Gujarati, Hindi or English. SthalaSutra reads it, translates it,
          and lets you search the archive by meaning and by place.
        </p>
      </div>

      <button type="button" className="specimen" onClick={() => { onQueryChange("રાણીની વાવ"); onSearch("રાણીની વાવ"); }}>
        <span className="specimen-script" lang="gu">રાણીની વાવ</span>
        <span className="specimen-gloss">Rani ki Vav, “the Queen’s stepwell”</span>
        <span className="specimen-hint">Search in Gujarati, find records in any language <ArrowRight size={13} aria-hidden /></span>
      </button>

      <form className="search-box" role="search" onSubmit={submit}>
        <Search size={19} aria-hidden />
        <label htmlFor="archive-search" className="visually-hidden">Search the archive</label>
        <input
          id="archive-search"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Try “stepwells near Ahmedabad” or a phrase in any script"
          autoComplete="off"
        />
        <button type="button" className="near-me" onClick={onNearMe} disabled={locating} aria-label="Search near my location">
          {locating ? <LoaderCircle className="spin" size={16} aria-hidden /> : <LocateFixed size={16} aria-hidden />}
          <span>Near me</span>
        </button>
        <button type="submit" className="search-submit" disabled={searching} aria-label="Search">
          {searching ? <LoaderCircle className="spin" size={17} aria-hidden /> : <ArrowRight size={18} aria-hidden />}
        </button>
      </form>
      {notice && <p className="search-notice" role="status">{notice}</p>}

      <div className="suggestions" aria-label="Example searches">
        {SUGGESTED_QUERIES.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            lang={/\p{Script=Gujarati}/u.test(suggestion) ? "gu" : undefined}
            onClick={() => { onQueryChange(suggestion); onSearch(suggestion); }}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <ol className="steps" aria-label="How it works">
        {STEPS.map((step, index) => (
          <li key={step.name}>
            <span className="step-number" aria-hidden>{index + 1}</span>
            <b>{step.name}</b>
            <span>{step.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
