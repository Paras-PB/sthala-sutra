"""Local OCR, translation and embedding adapters used by the Celery worker."""
import os
import re
import warnings
from collections import Counter
from collections.abc import Callable, Iterable, Iterator
from functools import lru_cache
from pathlib import Path

import numpy as np
import pytesseract
from PIL import Image, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 40_000_000
MAX_PDF_PAGES = 100
PREVIEW_MAX_EDGE = 1600


class ProcessingError(ValueError):
    """A problem with the uploaded file whose message is safe to show to users."""


def count_pages(path: Path) -> int:
    if path.suffix.lower() != ".pdf":
        return 1
    from pdf2image import pdfinfo_from_path
    from pdf2image.exceptions import PDFInfoNotInstalledError

    try:
        page_count = int(pdfinfo_from_path(str(path)).get("Pages", 0))
    except PDFInfoNotInstalledError:
        raise  # a server setup problem, not the user's file
    except Exception as exc:
        raise ProcessingError("The PDF could not be read. It may be damaged or password protected.") from exc
    if page_count < 1:
        raise ProcessingError("The PDF does not contain any readable pages.")
    if page_count > MAX_PDF_PAGES:
        raise ProcessingError(f"PDF uploads are limited to {MAX_PDF_PAGES} pages per archive item.")
    return page_count


def _images(path: Path, page_count: int) -> Iterator[Image.Image]:
    if path.suffix.lower() == ".pdf":
        from pdf2image import convert_from_path
        # Render one page at a time so a multi-page scan cannot exhaust worker memory.
        for page_number in range(1, page_count + 1):
            pages = convert_from_path(str(path), dpi=180, fmt="png", first_page=page_number, last_page=page_number)
            if pages:
                yield pages[0]
        return
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                rgb = image.convert("RGB")
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ProcessingError("The image is too large to process (over 40 megapixels).") from exc
    except UnidentifiedImageError as exc:
        raise ProcessingError("The file could not be read as an image.") from exc
    yield rgb


def preview_image(image: Image.Image, max_edge: int = PREVIEW_MAX_EDGE) -> Image.Image:
    """Return an RGB copy of `image` whose longest edge is at most `max_edge` pixels."""
    preview = image.convert("RGB")  # convert() always returns a new image, even for RGB input
    preview.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)  # keeps aspect ratio, never enlarges
    return preview


def save_preview(image: Image.Image, destination: Path) -> None:
    with preview_image(image) as preview:
        preview.save(destination, "JPEG", quality=85)


def ocr_document(path: Path, on_page: Callable[[int, int], None] | None = None,
                 preview_to: Path | None = None) -> list[tuple[int, str]]:
    """OCR every page and return (page_number, text) for pages that contain text.

    `on_page(number, total)` is called before each page is read (for page 1, after the
    preview has been written to `preview_to`).
    """
    total = count_pages(path)
    pages = []
    for number, image in enumerate(_images(path, total), start=1):
        try:
            if number == 1 and preview_to is not None:
                save_preview(image, preview_to)
            if on_page:
                on_page(number, total)
            text = _ocr_page(image)
        finally:
            image.close()
        if text:
            pages.append((number, text))
    return pages


def _ocr_page(image: Image.Image) -> str:
    text = pytesseract.image_to_string(image, lang="eng+hin+guj", config="--psm 6").strip()
    language = detect_language(text)
    if language not in {"hi", "gu"}:
        return text
    # The combined model often confuses Devanagari and Gujarati letterforms.
    # Re-run with only the detected script and keep it when it recognizes more
    # characters from that script; this also preserves Tesseract's mixed-script
    # output when the focused pass is less useful.
    tesseract_language = {"hi": "hin", "gu": "guj"}[language]
    best_script_count = _script_character_count(text, language)
    grayscale = ImageOps.grayscale(image)
    focused_image = ImageOps.autocontrast(grayscale)
    grayscale.close()
    if focused_image.width * focused_image.height <= 4_000_000:
        enlarged = focused_image.resize((focused_image.width * 2, focused_image.height * 2), Image.Resampling.LANCZOS)
        focused_image.close()
        focused_image = enlarged
    try:
        for candidate_image in (image, focused_image):
            focused = pytesseract.image_to_string(candidate_image, lang=tesseract_language, config="--psm 6").strip()
            script_count = _script_character_count(focused, language)
            if script_count > best_script_count:
                text = focused
                best_script_count = script_count
    finally:
        focused_image.close()
    return text


def _script_character_count(text: str, language: str) -> int:
    pattern = r"[\u0A80-\u0AFF]" if language == "gu" else r"[\u0900-\u097F]"
    return len(re.findall(pattern, text))


def detect_language(text: str) -> str:
    gujarati = _script_character_count(text, "gu")
    devanagari = _script_character_count(text, "hi")
    if max(gujarati, devanagari) >= 6:
        return "gu" if gujarati >= devanagari else "hi"
    return "en"


def most_common_language(languages: Iterable[str]) -> str | None:
    """Pick the language of most pages; ties go to the language seen first."""
    counts = Counter(languages)
    return counts.most_common(1)[0][0] if counts else None


@lru_cache(maxsize=1)
def _translator():
    model_name = os.getenv("TRANSLATION_MODEL", "facebook/nllb-200-distilled-600M").strip()
    from transformers import pipeline
    return pipeline("translation", model=model_name)


def translate_to_english(text: str, language: str) -> str | None:
    if language == "en":
        return text
    if language not in {"hi", "gu"}:
        return None
    translator = _translator()
    lang_code = {"hi": "hin_Deva", "gu": "guj_Gujr"}[language]
    chunks = _text_chunks(text, max_chars=1200)
    translated = []
    for offset in range(0, len(chunks), 8):
        result = translator(chunks[offset:offset + 8], src_lang=lang_code, tgt_lang="eng_Latn", max_length=512)
        translated.extend(item["translation_text"] for item in result if item.get("translation_text"))
    return "\n".join(translated) if translated else None


@lru_cache(maxsize=1)
def _embedder():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(os.getenv("EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"))


def embed_text(text: str) -> list[float]:
    chunks = _text_chunks(text, max_chars=700) or [text]
    vectors = _embedder().encode(chunks, normalize_embeddings=True, batch_size=16)
    mean_vector = vectors.mean(axis=0)
    magnitude = float(np.linalg.norm(mean_vector))
    if not magnitude:
        raise ProcessingError("Could not create a non-empty search embedding.")
    return (mean_vector / magnitude).tolist()


def _text_chunks(text: str, max_chars: int) -> list[str]:
    """Split long OCR passages at word boundaries without dropping their tail."""
    words = text.split()
    chunks: list[str] = []
    current: list[str] = []
    current_length = 0
    for word in words:
        if current and current_length + len(word) + 1 > max_chars:
            chunks.append(" ".join(current))
            current = []
            current_length = 0
        if len(word) > max_chars:
            for start in range(0, len(word), max_chars):
                part = word[start:start + max_chars]
                if current:
                    chunks.append(" ".join(current))
                    current = []
                    current_length = 0
                chunks.append(part)
            continue
        current.append(word)
        current_length += len(word) + (1 if current_length else 0)
    if current:
        chunks.append(" ".join(current))
    return chunks


# Gujarati (૦-૯) and Devanagari (०-९) digits mapped to ASCII 0-9.
_INDIC_DIGITS = str.maketrans("૦૧૨૩૪૫૬૭૮૯०१२३४५६७८९", "0123456789" * 2)
# Lookarounds instead of \b: in "૧૪૯૯માં" the year is glued to a Gujarati suffix,
# and \b sees no boundary between a digit and a letter.
_DATE_PATTERN = re.compile(
    r"(?<!\d)(?:"
    r"\d{1,2}(?:st|nd|rd|th)\s+century(?:\s+(?:BCE|CE|BC|AD)\b)?"  # 11th century, 3rd century BCE
    r"|\d{3,4}\s*(?:BCE|CE|BC|AD)\b"                                # 712 CE, 2400 BCE
    r"|(?:1\d|20)\d{2}s?(?!\d)"                                     # bare years 1000-2099, 1990s
    r")",
    flags=re.IGNORECASE,
)
# Last words that make a place name generic ("Adalaj Stepwell" -> also match "Adalaj").
_GENERIC_PLACE_WORDS = frozenset({"stepwell", "vav", "temple", "mandir", "mosque", "masjid", "fort",
                                  "palace", "lake", "tank", "kund", "tomb", "gate", "museum"})
# Shorter leading words such as "Rani" or "Dada" are titles or common nouns, not names.
_MIN_LEADING_WORD_LENGTH = 5
# (keyword, category); Latin keywords match whole words, Indic ones substrings
# because Gujarati/Hindi attach suffixes directly (વાવનું, મંદિરમાં).
_CATEGORY_KEYWORDS = (
    ("stepwell", "stepwell"), ("vav", "stepwell"), ("વાવ", "stepwell"), ("बावड़ी", "stepwell"), ("वाव", "stepwell"),
    ("fort", "fort"), ("કિલ્લ", "fort"), ("किला", "fort"),
    ("weaving", "craft"), ("textile", "craft"), ("patola", "craft"),
    ("temple", "temple"), ("mandir", "temple"), ("મંદિર", "temple"), ("मंदिर", "temple"),
)


def _find(text: str, phrase: str) -> int | None:
    """Return where `phrase` first occurs in `text` (case-insensitive, whole words), or None."""
    if phrase.isascii():
        pattern = rf"(?<!\w){re.escape(phrase)}s?(?!\w)"
    else:
        pattern = re.escape(phrase)
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return match.start() if match else None


def _place_phrases(name: str) -> list[str]:
    words = name.split()
    phrases = [name]
    if (len(words) > 1 and words[-1].casefold() in _GENERIC_PLACE_WORDS
            and len(words[0]) >= _MIN_LEADING_WORD_LENGTH):
        phrases.append(words[0])
    return phrases


def extract_dates(text: str) -> list[str]:
    normalized = text.translate(_INDIC_DIGITS)
    return list(dict.fromkeys(match.group(0).strip() for match in _DATE_PATTERN.finditer(normalized)))


def extract_places(text: str, known_places: Iterable[str]) -> list[str]:
    """Return the known place names mentioned in `text`, in order of first mention."""
    positions = {}
    for name in known_places:
        found = [p for p in (_find(text, phrase) for phrase in _place_phrases(name)) if p is not None]
        if found:
            positions[name] = min(found)
    return sorted(positions, key=positions.get)


def extract_category(text: str) -> str | None:
    return next((category for keyword, category in _CATEGORY_KEYWORDS if _find(text, keyword) is not None), None)


def extract_entities(text: str, known_places: Iterable[str] = ()) -> dict:
    # High precision rules; all source text is retained for later human correction.
    return {"places": extract_places(text, known_places), "dates": extract_dates(text),
            "category": extract_category(text)}
