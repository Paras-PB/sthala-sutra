"""Unit tests for the pure helpers in ml/pipeline.py (no Tesseract or ML models needed)."""
import pytest
from PIL import Image

from ml.pipeline import (_text_chunks, detect_language, extract_entities, most_common_language, preview_image)

ALLOWED_CATEGORIES = {"stepwell", "fort", "craft", "temple", "other"}
KNOWN_PLACES = ["Adalaj Stepwell", "Rani ki Vav", "Modhera Sun Temple", "Dada Harir Stepwell", "Patan"]


# --- _text_chunks -----------------------------------------------------------------

def test_text_chunks_keep_every_word_in_order():
    words = [f"word{i}" for i in range(500)]
    chunks = _text_chunks(" ".join(words), max_chars=100)
    assert " ".join(chunks).split() == words  # nothing lost at the tail


def test_text_chunks_respect_length_bound():
    chunks = _text_chunks("lorem ipsum dolor sit amet " * 200, max_chars=120)
    assert all(len(chunk) <= 120 for chunk in chunks)


def test_text_chunks_split_single_long_word():
    chunks = _text_chunks("short " + "x" * 250 + " tail", max_chars=100)
    assert chunks == ["short", "x" * 100, "x" * 100, "x" * 50, "tail"]


def test_text_chunks_empty_text():
    assert _text_chunks("   ", max_chars=50) == []


# --- detect_language --------------------------------------------------------------

@pytest.mark.parametrize(("text", "expected"), [
    ("The stepwell has five storeys.", "en"),
    ("અડાલજની વાવ ગાંધીનગર પાસે આવેલી છે.", "gu"),
    ("रानी की वाव पाटन में है।", "hi"),
    ("Rani ki Vav वाव", "en"),  # fewer than six Indic letters stays English
])
def test_detect_language(text, expected):
    assert detect_language(text) == expected


# --- most_common_language ----------------------------------------------------------

def test_most_common_language_uses_majority_not_last_page():
    assert most_common_language(["gu", "gu", "en"]) == "gu"


def test_most_common_language_tie_keeps_first_seen():
    assert most_common_language(["hi", "en"]) == "hi"


def test_most_common_language_empty():
    assert most_common_language([]) is None


# --- extract_entities: dates --------------------------------------------------------

def test_gujarati_digits_are_normalised():
    assert extract_entities("રાણી રૂડાબાઈએ ઈ.સ. ૧૪૯૯માં આ વાવનું નિર્માણ કરાવ્યું")["dates"] == ["1499"]


def test_devanagari_digits_are_normalised():
    assert extract_entities("वर्ष २०१४ में घोषित")["dates"] == ["2014"]


def test_years_with_era_markers():
    dates = extract_entities("A dockyard from around 2400 BCE; a grant of 712 CE; rebuilt 1026 AD.")["dates"]
    assert dates == ["2400 BCE", "712 CE", "1026 AD"]


def test_centuries():
    dates = extract_entities("Built in the 11th century and repaired in the 3rd century BCE.")["dates"]
    assert dates == ["11th century", "3rd century BCE"]


def test_plain_numbers_are_not_dates():
    assert extract_entities("A 100 page register with 500 entries and 12345 rows.")["dates"] == []


# --- extract_entities: places ----------------------------------------------------------

def test_known_place_matches_case_insensitively():
    assert extract_entities("we visited RANI KI VAV at dawn", KNOWN_PLACES)["places"] == ["Rani ki Vav"]


def test_leading_word_rule_matches_generic_suffix_names():
    places = extract_entities("Adalaj ni Vav stands north of Ahmedabad.", KNOWN_PLACES)["places"]
    assert places == ["Adalaj Stepwell"]


def test_short_leading_words_are_not_enough():
    # "Dada" alone is a common word, so "Dada Harir Stepwell" needs its full name.
    assert extract_entities("My dada told this story.", KNOWN_PLACES)["places"] == []


def test_places_are_ordered_by_first_mention():
    text = "At Modhera, the Sun Temple ... later we drove to Patan to see Rani ki Vav."
    assert extract_entities(text, KNOWN_PLACES)["places"] == ["Modhera Sun Temple", "Patan", "Rani ki Vav"]


def test_place_names_do_not_match_inside_words():
    assert extract_entities("Patanjali wrote sutras.", KNOWN_PLACES)["places"] == []


def test_no_known_places_means_no_places():
    assert extract_entities("Rani ki Vav")["places"] == []


# --- extract_entities: categories --------------------------------------------------------

@pytest.mark.parametrize(("text", "expected"), [
    ("The stepwells of Gujarat", "stepwell"),
    ("અડાલજની વાવનું નિર્માણ", "stepwell"),
    ("The fort walls", "fort"),
    ("Patola weaving families", "craft"),
    ("મોઢેરાનું સૂર્યમંદિર", "temple"),
    ("The effort was worth it", None),  # "fort" must be a whole word
    ("A Harappan port town", None),
])
def test_categories(text, expected):
    category = extract_entities(text)["category"]
    assert category == expected
    assert category is None or category in ALLOWED_CATEGORIES


# --- preview_image ------------------------------------------------------------------------

def test_preview_shrinks_longest_edge_and_keeps_aspect_ratio():
    with Image.new("RGBA", (4000, 2000), (10, 20, 30, 255)) as source:
        preview = preview_image(source)
    assert preview.mode == "RGB"
    assert preview.size == (1600, 800)


def test_preview_does_not_enlarge_small_images_and_returns_a_copy():
    with Image.new("L", (300, 500), 128) as source:
        preview = preview_image(source)
        assert preview is not source
    assert preview.mode == "RGB"
    assert preview.size == (300, 500)
