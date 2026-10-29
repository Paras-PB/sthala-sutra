import { ArrowUpRight, BookOpen, MapPin, Sparkles } from "lucide-react";
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
      <div className="section-head">
        <div>
          <h2 id="nearby-heading">Nearby public references</h2>
          <p>Wikipedia articles about heritage sites within 10 km of {placeName}</p>
        </div>
        <span className="count-chip wiki">{references.length} from Wikipedia</span>
      </div>
      {references.length === 0 ? (
        <div className="empty-state compact">
          <BookOpen size={22} aria-hidden />
          <b>No heritage articles within 10 km</b>
          <span>Try the name of a larger nearby town.</span>
        </div>
      ) : (
        <div className="nearby-grid">
          {references.map((item) => (
            <article className="nearby-card" key={item.id}>
              <div className="nearby-media">
                {item.image_url ? <img src={item.image_url} alt="" loading="lazy" /> : <BookOpen size={24} aria-hidden />}
              </div>
              <div className="nearby-body">
                <p className="card-kicker wiki">{item.categories[0]?.replace(/^.+?:/, "") || "Heritage site"}</p>
                <h3>{item.title}</h3>
                <p className="nearby-summary">{item.description || "Open the article for more information."}</p>
                <p className="nearby-distance"><MapPin size={12} aria-hidden />{formatMeters(item.distance_meters)} away</p>
                <div className="nearby-actions">
                  <button type="button" onClick={() => onAsk(item)}><Sparkles size={13} aria-hidden />Ask the guide</button>
                  <a href={item.article_url} target="_blank" rel="noreferrer">Read on Wikipedia <ArrowUpRight size={12} aria-hidden /></a>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="attribution">Summaries and images come from Wikipedia and Wikimedia Commons. Verify details against primary sources before citing.</p>
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
      <p className="modal-kicker wiki">Public reference · Wikipedia</p>
      <h2 id="reference-title">{reference.title}</h2>
      <p className="reference-text">{reference.description || "Open the article for more information."}</p>
      <p className="reference-meta">
        <span><MapPin size={14} aria-hidden />{formatMeters(reference.distance_meters)} from the searched place</span>
        <a className="text-link" href={reference.article_url} target="_blank" rel="noreferrer">Read on Wikipedia <ArrowUpRight size={13} aria-hidden /></a>
      </p>
      <HeritageGuide key={reference.id} kind="reference" targetId={reference.id} title={reference.title} />
    </Modal>
  );
}
