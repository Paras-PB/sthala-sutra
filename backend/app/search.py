"""Pure reranking helpers for hybrid (semantic + lexical) search. No database access."""
import string
import uuid
from dataclasses import dataclass

SEMANTIC_WEIGHT = 0.8
LEXICAL_WEIGHT = 0.2
MIN_TERM_LENGTH = 3
STOPWORDS = frozenset({
    "about", "and", "are", "for", "from", "near", "not", "of", "in", "the", "this", "that", "was", "were", "with",
})
# string.punctuation is ASCII only; add the Devanagari danda and typographic quotes/dashes.
PUNCTUATION = string.punctuation + "।॥“”‘’–—"


@dataclass(frozen=True)
class Candidate:
    """One passage returned by the vector query, before reranking."""
    artifact_id: uuid.UUID
    page_number: int
    original_text: str
    translated_text: str | None
    distance: float  # pgvector cosine distance: 0 = same direction, 2 = opposite
    distance_km: float | None = None


@dataclass(frozen=True)
class RankedHit:
    candidate: Candidate
    score: float
    semantic_score: float


def query_terms(query: str) -> list[str]:
    """Distinct casefolded words worth matching literally, in query order."""
    words = (word.strip(PUNCTUATION) for word in query.casefold().split())
    terms = [word for word in words if len(word) >= MIN_TERM_LENGTH and word not in STOPWORDS]
    return list(dict.fromkeys(terms))


def lexical_score(terms: list[str], original_text: str, translated_text: str | None) -> float:
    """Fraction of query terms found in either text.

    Substring matching (not tokenizing) so it works for Hindi/Gujarati, whose vowel
    signs are not regex word characters, and so "stepwell" also matches "stepwells".
    """
    if not terms:
        return 0.0
    haystack = f"{original_text}\n{translated_text or ''}".casefold()
    return sum(term in haystack for term in terms) / len(terms)


def rerank(query: str, candidates: list[Candidate], limit: int) -> list[RankedHit]:
    """Score every candidate, keep each artifact's best passage, return the top `limit`."""
    terms = query_terms(query)
    best_per_artifact: dict[uuid.UUID, RankedHit] = {}
    for candidate in candidates:
        semantic = 1 - candidate.distance
        lexical = lexical_score(terms, candidate.original_text, candidate.translated_text)
        hit = RankedHit(candidate=candidate, score=SEMANTIC_WEIGHT * semantic + LEXICAL_WEIGHT * lexical,
                        semantic_score=semantic)
        current = best_per_artifact.get(candidate.artifact_id)
        if current is None or hit.score > current.score:
            best_per_artifact[candidate.artifact_id] = hit
    # sorted() is stable, so equal scores keep the database's distance order.
    return sorted(best_per_artifact.values(), key=lambda hit: hit.score, reverse=True)[:limit]
