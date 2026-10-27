"""Local OCR, translation and embedding adapters used by the Celery worker."""
import os
import re
import warnings
from functools import lru_cache
from pathlib import Path

import pytesseract
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 40_000_000


def _images(path: Path):
    if path.suffix.lower() == ".pdf":
        from pdf2image import convert_from_path, pdfinfo_from_path
        page_count = int(pdfinfo_from_path(str(path)).get("Pages", 0))
        if page_count < 1:
            raise ValueError("The PDF does not contain any readable pages.")
        if page_count > 100:
            raise ValueError("PDF uploads are limited to 100 pages per archive item.")
        # Render one page at a time so a multi-page scan cannot exhaust worker memory.
        for page_number in range(1, page_count + 1):
            pages = convert_from_path(str(path), dpi=180, fmt="png", first_page=page_number, last_page=page_number)
            if pages:
                yield pages[0]
    else:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                yield image.convert("RGB")


def ocr_document(path: Path) -> list[tuple[int, str]]:
    pages = []
    for number, image in enumerate(_images(path), start=1):
        text = pytesseract.image_to_string(image, lang="eng+hin+guj", config="--psm 6").strip()
        language = detect_language(text)
        if language in {"hi", "gu"}:
            # The combined model often confuses Devanagari and Gujarati letterforms.
            # Re-run with only the detected script and keep it when it recognizes more
            # characters from that script; this also preserves Tesseract's mixed-script
            # output when the focused pass is less useful.
            tesseract_language = {"hi": "hin", "gu": "guj"}[language]
            best_script_count = _script_character_count(text, language)
            focused_image = ImageOps.autocontrast(ImageOps.grayscale(image))
            if focused_image.width * focused_image.height <= 4_000_000:
                focused_image = focused_image.resize(
                    (focused_image.width * 2, focused_image.height * 2), Image.Resampling.LANCZOS
                )
            try:
                for candidate_image in (image, focused_image):
                    focused = pytesseract.image_to_string(
                        candidate_image, lang=tesseract_language, config="--psm 6"
                    ).strip()
                    script_count = _script_character_count(focused, language)
                    if script_count > best_script_count:
                        text = focused
                        best_script_count = script_count
            finally:
                focused_image.close()
        if text:
            pages.append((number, text))
    return pages


def _script_character_count(text: str, language: str) -> int:
    pattern = r"[\u0A80-\u0AFF]" if language == "gu" else r"[\u0900-\u097F]"
    return len(re.findall(pattern, text))


def detect_language(text: str) -> str:
    gujarati = _script_character_count(text, "gu")
    devanagari = _script_character_count(text, "hi")
    if max(gujarati, devanagari) >= 6:
        return "gu" if gujarati >= devanagari else "hi"
    return "en"


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
    import numpy as np

    chunks = _text_chunks(text, max_chars=700) or [text]
    vectors = _embedder().encode(chunks, normalize_embeddings=True, batch_size=16)
    mean_vector = vectors.mean(axis=0)
    magnitude = float(np.linalg.norm(mean_vector))
    if not magnitude:
        raise ValueError("Could not create a non-empty search embedding.")
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


def extract_entities(text: str) -> dict:
    # High precision seed rules; retain all source text for later human correction.
    places = [name for name in ("Rani ki Vav", "Adalaj", "Dada Harir", "Ahmedabad", "Patan", "Gandhinagar") if name.casefold() in text.casefold()]
    eras = re.findall(r"\b(?:(?:[1-9]|1[0-9]|20|21)(?:st|nd|rd|th)\s+century|1[0-9]{3}(?:s)?)\b", text, flags=re.IGNORECASE)
    category = next((kind for keyword, kind in (("stepwell", "stepwell"), ("vav", "stepwell"),
                                                  ("fort", "fort"), ("weaving", "craft"),
                                                  ("textile", "craft"), ("temple", "temple"))
                     if keyword in text.casefold()), None)
    return {"places": places, "dates": eras, "category": category}
