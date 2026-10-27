"""Local OCR, translation and embedding adapters used by the Celery worker."""
import os
import re
from functools import lru_cache
from pathlib import Path

import pytesseract
from PIL import Image


def _images(path: Path):
    if path.suffix.lower() == ".pdf":
        from pdf2image import convert_from_path
        yield from convert_from_path(str(path), dpi=180, fmt="png")
    else:
        with Image.open(path) as image:
            yield image.convert("RGB")


def ocr_document(path: Path) -> list[tuple[int, str]]:
    pages = []
    for number, image in enumerate(_images(path), start=1):
        text = pytesseract.image_to_string(image, lang="eng+hin+guj", config="--psm 6").strip()
        if text:
            pages.append((number, text))
    return pages


def detect_language(text: str) -> str:
    if re.search(r"[\u0A80-\u0AFF]", text):
        return "gu"
    if re.search(r"[\u0900-\u097F]", text):
        return "hi"
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
    result = translator(text[:4000], src_lang=lang_code, tgt_lang="eng_Latn", max_length=512)
    return result[0]["translation_text"] if result else None


@lru_cache(maxsize=1)
def _embedder():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(os.getenv("EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"))


def embed_text(text: str) -> list[float]:
    return _embedder().encode(text, normalize_embeddings=True).tolist()


def extract_entities(text: str) -> dict:
    # High precision seed rules; retain all source text for later human correction.
    places = [name for name in ("Rani ki Vav", "Adalaj", "Dada Harir", "Ahmedabad", "Patan", "Gandhinagar") if name.casefold() in text.casefold()]
    eras = re.findall(r"\b(?:(?:[1-9]|1[0-9]|20|21)(?:st|nd|rd|th)\s+century|1[0-9]{3}(?:s)?)\b", text, flags=re.IGNORECASE)
    category = next((kind for keyword, kind in (("stepwell", "stepwell"), ("vav", "stepwell"),
                                                  ("fort", "fort"), ("weaving", "craft"),
                                                  ("textile", "craft"), ("temple", "temple"))
                     if keyword in text.casefold()), None)
    return {"places": places, "dates": eras, "category": category}
