"""Create clearly labeled synthetic field-note samples around Gujarat and queue ingestion."""
import os
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, features
from geoalchemy2.elements import WKTElement

from .database import SessionLocal, initialize_database
from .models import Artifact, MapFeature, Place
from .settings import UPLOAD_DIR
from .worker import process_artifact
from ml.pipeline import detect_language

ROOT = Path(__file__).resolve().parents[2]
SAMPLE_DIR = Path(os.getenv("SAMPLE_DIR", str(ROOT / "data" / "sample")))
DEJAVU = Path("/usr/share/fonts/truetype/dejavu")
NOTO = Path("/usr/share/fonts/truetype/noto")  # Debian package fonts-noto-core
BODY_FONTS = {"en": DEJAVU / "DejaVuSerif.ttf", "gu": NOTO / "NotoSansGujarati-Regular.ttf",
              "hi": NOTO / "NotoSansDevanagari-Regular.ttf"}
SAMPLES = [
    {"title": "Adalaj Stepwell · Sample field note", "category": "stepwell", "era": "15th century", "place": "Adalaj Stepwell", "region": "Gujarat", "lat": 23.1667, "lng": 72.5833,
     "body": "Adalaj ni Vav stands north of Ahmedabad. Its five storeys descend through carved pillars and shaded landings. Local memory connects the stepwell with Queen Rudabai and the water routes of the old settlement."},
    {"title": "Rani ki Vav · Sample field note", "category": "stepwell", "era": "11th century", "place": "Rani ki Vav", "region": "Gujarat", "lat": 23.8589, "lng": 72.1019,
     "body": "At Patan, Rani ki Vav turns the act of drawing water into an architectural procession. Sculpted figures line the descending terraces. The monument records Solanki-era craft and a long relationship between water, ritual, and public life."},
    {"title": "Kutch weaving · Sample field note", "category": "craft", "era": "20th century", "place": "Bhuj", "region": "Gujarat", "lat": 23.2420, "lng": 69.6669,
     "body": "In Kutch, woven patterns carry family and village histories. A textile can mark migration, celebration, and the hands that made it. This sample note is included to demonstrate archive search across cultural material as well as monuments."},
    {"title": "Modhera Sun Temple · Sample field note", "category": "temple", "era": "11th century", "place": "Modhera Sun Temple", "region": "Gujarat", "lat": 23.5835, "lng": 72.1330,
     "body": "At Modhera, the Sun Temple of the Chaulukya king Bhima I faces the eastern sunrise across the stepped Surya Kund. Its carved pillars, sanctum and dance hall date to 1026–27 CE. The temple shows how ritual, astronomy and water architecture were designed together."},
    {"title": "Dada Harir Stepwell · Sample field note", "category": "stepwell", "era": "15th century", "place": "Dada Harir Stepwell", "region": "Gujarat", "lat": 23.0436, "lng": 72.6036,
     "body": "In Asarwa, Ahmedabad, the Dada Harir stepwell descends five levels to an octagonal well. An inscription credits Bai Harir Sultani with its construction in 1499. Travellers once rested in its cool galleries during the summer heat."},
    {"title": "Sidi Saiyyed Mosque jali · Sample field note", "category": "other", "era": "16th century", "place": "Sidi Saiyyed Mosque", "region": "Gujarat", "lat": 23.0270, "lng": 72.5810,
     "body": "The Sidi Saiyyed Mosque in Ahmedabad was completed in 1573. Its carved stone lattice of an intertwined tree has become a symbol of the city. The jali filters light while keeping the prayer hall cool and private."},
    {"title": "Patan Patola weaving · Sample field note", "category": "craft", "era": "Living tradition", "place": "Patan", "region": "Gujarat", "lat": 23.8493, "lng": 72.1266,
     "body": "In Patan, Salvi weaving families make Patola saris with double ikat, dyeing both warp and weft threads before they meet on the loom. A single sari can take months of work. The craft keeps a geometric vocabulary passed down through generations."},
    {"title": "Lothal dockyard · Sample field note", "category": "other", "era": "Harappan, c. 2400 BCE", "place": "Lothal", "region": "Gujarat", "lat": 22.5219, "lng": 72.2497,
     "body": "Lothal, near the Gulf of Khambhat, was a Harappan port town. Archaeologists identified a large brick basin as a possible dockyard from around 2400 BCE. Bead workshops and seals suggest the town traded across the Arabian Sea."},
    # Multilingual samples: native-script OCR -> English translation -> cross-lingual search.
    {"title": "Adalaj ni Vav · Gujarati sample field note", "category": "stepwell", "era": "15th century", "place": "Adalaj Stepwell", "region": "Gujarat", "lat": 23.1667, "lng": 72.5833,
     "body": "અડાલજની વાવ ગાંધીનગર પાસે આવેલી પાંચ માળની વાવ છે. રાણી રૂડાબાઈએ ઈ.સ. ૧૪૯૯માં આ વાવનું નિર્માણ પૂર્ણ કરાવ્યું હતું. તેના સ્તંભો અને ઝરૂખાઓ પર ફૂલ, વેલ અને પ્રાણીઓની સુંદર કોતરણી છે. ઉનાળામાં પણ વાવની અંદર ઠંડક રહે છે."},
    {"title": "Rani ki Vav · Hindi sample field note", "category": "stepwell", "era": "11th century", "place": "Rani ki Vav", "region": "Gujarat", "lat": 23.8589, "lng": 72.1019,
     "body": "रानी की वाव गुजरात के पाटन नगर में स्थित एक भव्य सीढ़ीदार बावड़ी है। इसका निर्माण ग्यारहवीं शताब्दी में रानी उदयमती ने राजा भीमदेव प्रथम की स्मृति में करवाया था। इसकी दीवारों पर देवी-देवताओं की सैकड़ों मूर्तियाँ उकेरी गई हैं। वर्ष 2014 में इसे यूनेस्को विश्व धरोहर स्थल घोषित किया गया।"},
    {"title": "Modhera Surya Mandir · Gujarati sample field note", "category": "temple", "era": "11th century", "place": "Modhera Sun Temple", "region": "Gujarat", "lat": 23.5835, "lng": 72.1330,
     "body": "મોઢેરાનું સૂર્યમંદિર પુષ્પાવતી નદીના કિનારે આવેલું છે. સોલંકી રાજા ભીમદેવ પહેલાએ ઈ.સ. ૧૦૨૬માં આ મંદિર બંધાવ્યું હતું. મંદિરની સામે આવેલો સૂર્યકુંડ પગથિયાંની અદ્ભુત ભૌમિતિક રચના માટે જાણીતો છે."},
]
MAP_SAMPLES = [
    ("Sample stepwell study route", "route", "Gujarat", "Synthetic demonstration route linking two sample stepwell records.",
     "LINESTRING(72.5833 23.1667,72.1019 23.8589)", "Rani ki Vav · Sample field note"),
    ("Sample Kutch oral-history pin", "folklore", "Gujarat", "Synthetic folklore pin showing how a place-based oral-history record is linked to its source note.",
     "POINT(69.6669 23.2420)", "Kutch weaving · Sample field note"),
    ("Sample Gujarat water-heritage trail", "route", "Gujarat",
     "Synthetic demonstration route linking four sample water-heritage records from Ahmedabad to Patan.",
     "LINESTRING(72.6036 23.0436,72.5833 23.1667,72.1330 23.5835,72.1019 23.8589)", "Dada Harir Stepwell · Sample field note"),
    ("Sample Rudabai legend pin", "folklore", "Gujarat",
     "Synthetic folklore pin: a local retelling of Queen Rudabai completing the Adalaj stepwell, linked to its source note.",
     "POINT(72.5833 23.1667)", "Adalaj ni Vav · Gujarati sample field note"),
]


def _font(path: Path, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    # Gujarati and Devanagari need complex text shaping (conjuncts, vowel signs), which
    # only the Raqm layout engine does; without it the rendered text is unreadable to OCR.
    layout = ImageFont.Layout.RAQM if features.check("raqm") else ImageFont.Layout.BASIC
    try:
        return ImageFont.truetype(str(path), size, layout_engine=layout)
    except OSError:
        print(f"Warning: font {path} is missing; falling back to Pillow's default font.")
        return ImageFont.load_default(size=size)


def wrap_to_width(draw: ImageDraw.ImageDraw, text: str, font, max_width: float) -> list[str]:
    """Greedy word wrap by rendered width; character counts are wrong for combining marks."""
    lines: list[str] = []
    for word in text.split():
        candidate = f"{lines[-1]} {word}" if lines else word
        if lines and draw.textlength(candidate, font=font) <= max_width:
            lines[-1] = candidate
        else:
            lines.append(word)
    return lines


def make_scan(index: int, title: str, body: str) -> Path:
    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    path = SAMPLE_DIR / f"field-note-{index}.png"
    if path.exists():
        return path
    image = Image.new("RGB", (1350, 900), "#eee9da")
    draw = ImageDraw.Draw(image)
    serif = _font(DEJAVU / "DejaVuSerif.ttf", 38)
    body_font = _font(BODY_FONTS[detect_language(body)], 29)
    small = _font(DEJAVU / "DejaVuSans.ttf", 18)
    draw.rectangle((54, 54, 1296, 846), outline="#a69c83", width=3)
    draw.text((100, 102), "STHALASUTRA · SAMPLE ARCHIVE", font=small, fill="#726b59")
    draw.line((100, 145, 1250, 145), fill="#bcb39e", width=2)
    draw.text((100, 190), title, font=serif, fill="#2e3d32")
    y = 285
    for line in wrap_to_width(draw, body, body_font, max_width=1150):
        draw.text((100, y), line, font=body_font, fill="#3f433b")
        y += 56
    draw.line((100, 735, 1250, 735), fill="#bcb39e", width=2)
    draw.text((100, 762), "SYNTHETIC FIELD NOTE · FOR OCR AND SEARCH DEMONSTRATION", font=small, fill="#786f5d")
    image.save(path)
    return path


def main():
    if not features.check("raqm"):
        print("Warning: Pillow's Raqm layout is unavailable (install libfribidi0); "
              "Gujarati and Hindi samples will render without shaping and OCR poorly.")
    initialize_database()
    db = SessionLocal()
    queued = []
    try:
        for idx, sample in enumerate(SAMPLES, start=1):
            existing = db.query(Artifact).filter(Artifact.title == sample["title"]).first()
            if existing:
                continue
            place = db.query(Place).filter(Place.name == sample["place"]).first()
            if not place:
                place = Place(name=sample["place"], region=sample["region"],
                              geom=WKTElement(f"POINT({sample['lng']} {sample['lat']})", srid=4326))
                db.add(place)
                db.flush()
            source = make_scan(idx, sample["title"], sample["body"])
            artifact_id = uuid.uuid4()
            stored = f"{artifact_id}.png"
            (UPLOAD_DIR / stored).write_bytes(source.read_bytes())
            row = Artifact(id=artifact_id, title=sample["title"], original_filename=source.name, storage_path=stored,
                           media_type="image/png", category=sample["category"], era=sample["era"], status="queued",
                           place=place, latitude=sample["lat"], longitude=sample["lng"])
            db.add(row)
            db.flush()
            queued.append(str(row.id))
        db.flush()
        samples_by_title = {row.title: row for row in db.query(Artifact).filter(Artifact.title.in_([s["title"] for s in SAMPLES])).all()}
        for title, kind, region, description, wkt, artifact_title in MAP_SAMPLES:
            if not db.query(MapFeature).filter(MapFeature.title == title).first():
                db.add(MapFeature(title=title, feature_type=kind, region=region, description=description,
                                  geom=WKTElement(wkt, srid=4326), artifact_id=samples_by_title[artifact_title].id))
        db.commit()
    finally:
        db.close()
    for artifact_id in queued:
        process_artifact.delay(artifact_id)
    print(f"Queued {len(queued)} sample records. Re-running is safe; existing sample records are skipped.")


if __name__ == "__main__":
    main()
