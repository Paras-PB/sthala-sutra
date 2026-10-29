import { ArrowUpRight } from "lucide-react";
import HeritageGuide from "@/components/HeritageGuide";
import Modal from "@/components/Modal";
import { formatMeters } from "@/lib/archive-client";
import type { NearbyReference } from "@/types/archive";

type NearbyResultsProps = {
  placeName: string;
  references: NearbyReference[];
  onAsk: (reference: NearbyReference) => void;
};

/** Wikipedia articles with coordinates near the searched place, filtered to heritage sites. */
export default function NearbyResults({ placeName, references, onAsk }: NearbyResultsProps) {
  return (
    <section className="results-section" aria-labelledby="nearby-heading">
      <header className="section-head">
        <div>
          <h2 id="nearby-heading">Nearby public references</h2>
          <p>Wikipedia articles on heritage sites within 10 km of {placeName}</p>
        </div>
        <span className="section-count">{references.length} from Wikipedia</span>
      </header>
      {references.length === 0 ? (
        <div className="index-card compact">
          <p className="index-card-label">No references</p>
          <h3>Nothing catalogued on Wikipedia within 10 km</h3>
          <p>Try the name of a larger nearby town.</p>
        </div>
      ) : (
        <div className="entry-grid">
          {references.map((item, index) => (
            <article className="entry reference" key={item.id}>
              <p className="entry-head"><span>Ref. {String(index + 1).padStart(2, "0")}</span><span>Wikipedia</span></p>
              <figure className="plate">
                {item.image_url
                  ? <img className="artifact-preview" src={item.image_url} alt="" loading="lazy" />
                  : <div className="artifact-preview placeholder"><span className="placeholder-note">No image on Wikipedia</span></div>}
                <figcaption>{formatMeters(item.distance_meters)} from {placeName}</figcaption>
              </figure>
              <h3>{item.title}</h3>
              <p className="entry-meta">{item.categories[0]?.replace(/^.+?:/, "") || "Heritage site"}</p>
              <p className="snippet">{item.description || "Open the article for more information."}</p>
              <p className="entry-actions">
                <button type="button" className="text-link" onClick={() => onAsk(item)}>Ask the guide</button>
                <a className="text-link" href={item.article_url} target="_blank" rel="noreferrer">Read on Wikipedia <ArrowUpRight size={12} aria-hidden /></a>
              </p>
            </article>
          ))}
        </div>
      )}
      <p className="attribution">Summaries and images from Wikipedia and Wikimedia Commons. Verify against primary sources before citing.</p>
    </section>
  );
}

type NearbyReferenceModalProps = {
  reference: NearbyReference;
  onClose: () => void;
};

export function NearbyReferenceModal({ reference, onClose }: NearbyReferenceModalProps) {
  return (
    <Modal labelledBy="reference-title" onClose={onClose} className="reference-modal">
      <p className="modal-kicker">Public reference · Wikipedia</p>
      <h2 id="reference-title">{reference.title}</h2>
      <p className="reference-text">{reference.description || "Open the article for more information."}</p>
      <p className="reference-meta">
        <span>{formatMeters(reference.distance_meters)} from the searched place</span>
        <a className="text-link" href={reference.article_url} target="_blank" rel="noreferrer">Read on Wikipedia <ArrowUpRight size={13} aria-hidden /></a>
      </p>
      <HeritageGuide key={reference.id} kind="reference" targetId={reference.id} title={reference.title} />
    </Modal>
  );
}
