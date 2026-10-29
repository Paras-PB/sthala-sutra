import uuid

import pytest

from app.search import Candidate, lexical_score, query_terms, rerank

A, B, C = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def candidate(artifact_id: uuid.UUID, distance: float, text: str = "", translated: str | None = None,
              page: int = 1) -> Candidate:
    return Candidate(artifact_id=artifact_id, page_number=page, original_text=text,
                     translated_text=translated, distance=distance)


class TestQueryTerms:
    def test_casefolds_and_drops_short_words_and_stopwords(self):
        assert query_terms("Stepwells NEAR the old Fort of Patan") == ["stepwells", "old", "fort", "patan"]

    def test_strips_punctuation_and_deduplicates_in_order(self):
        assert query_terms("fort, Fort! (temple) “fort”") == ["fort", "temple"]

    def test_every_listed_stopword_is_removed(self):
        assert query_terms("near the and of in with") == []

    def test_keeps_non_latin_words(self):
        # Devanagari vowel signs are not regex \w characters; whitespace splitting keeps the word whole.
        assert query_terms("रानी की वाव।") == ["रानी", "वाव"]


class TestLexicalScore:
    def test_fraction_of_terms_found(self):
        assert lexical_score(["stepwell", "patan"], "A stepwell in Adalaj", None) == 0.5

    def test_matches_translated_text_case_insensitively(self):
        assert lexical_score(["stepwell"], "रानी की वाव", "The STEPWELL at Patan") == 1.0

    def test_no_terms_scores_zero(self):
        assert lexical_score([], "anything", "anything") == 0.0


class TestRerank:
    def test_score_blends_semantic_and_lexical(self):
        [hit] = rerank("stepwell", [candidate(A, distance=0.25, text="a stepwell")], limit=5)
        assert hit.semantic_score == pytest.approx(0.75)
        assert hit.score == pytest.approx(0.8 * 0.75 + 0.2 * 1.0)

    def test_lexical_match_can_overtake_a_slightly_closer_vector(self):
        closer_no_words = candidate(A, distance=0.30, text="water architecture")
        farther_with_words = candidate(B, distance=0.35, text="Rani ki Vav stepwell, Patan")
        hits = rerank("Patan stepwell", [closer_no_words, farther_with_words], limit=5)
        assert [hit.candidate.artifact_id for hit in hits] == [B, A]

    def test_lexical_boost_cannot_beat_a_much_closer_vector(self):
        close = candidate(A, distance=0.05, text="unrelated words")
        far_with_words = candidate(B, distance=0.60, text="stepwell")
        hits = rerank("stepwell", [close, far_with_words], limit=5)
        assert [hit.candidate.artifact_id for hit in hits] == [A, B]

    def test_keeps_only_the_best_passage_per_artifact(self):
        page_one = candidate(A, distance=0.40, text="introduction", page=1)
        page_two = candidate(A, distance=0.45, text="the fort walls", page=2)
        other = candidate(B, distance=0.50, text="other")
        hits = rerank("fort", [page_one, page_two, other], limit=5)
        assert [hit.candidate.artifact_id for hit in hits] == [A, B]
        # Page 2 is farther in vector space but wins on the lexical match.
        assert hits[0].candidate.page_number == 2

    def test_sorted_by_score_descending_and_cut_to_limit(self):
        candidates = [candidate(A, 0.6), candidate(B, 0.2), candidate(C, 0.4)]
        hits = rerank("unmatched", candidates, limit=2)
        assert [hit.candidate.artifact_id for hit in hits] == [B, C]
        assert hits[0].score >= hits[1].score

    def test_limit_applies_after_deduplication(self):
        candidates = [candidate(A, 0.1, page=1), candidate(A, 0.2, page=2), candidate(B, 0.3)]
        hits = rerank("unmatched", candidates, limit=2)
        assert [hit.candidate.artifact_id for hit in hits] == [A, B]

    def test_equal_scores_keep_database_order(self):
        hits = rerank("unmatched", [candidate(B, 0.3), candidate(A, 0.3)], limit=5)
        assert [hit.candidate.artifact_id for hit in hits] == [B, A]

    def test_empty_candidates(self):
        assert rerank("fort", [], limit=5) == []
