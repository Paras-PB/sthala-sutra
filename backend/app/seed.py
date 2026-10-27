"""Create three clearly labeled synthetic field-note samples and queue ingestion."""
import os
import textwrap
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from geoalchemy2.elements import WKTElement

from .database import SessionLocal, initialize_database
from .models import Artifact, MapFeature, Place
from .settings import UPLOAD_DIR
from .worker import process_artifact

ROOT = Path(__file__).resolve().parents[2]
SAMPLE_DIR = Path(os.getenv("SAMPLE_DIR", str(ROOT / "data" / "sample")))
SAMPLES = [
    {"title":"Adalaj Stepwell · Sample field note", "category":"stepwell", "era":"15th century", "place":"Adalaj Stepwell", "region":"Gujarat", "lat":23.1667, "lng":72.5833,
     "body":"Adalaj ni Vav stands north of Ahmedabad. Its five storeys descend through carved pillars and shaded landings. Local memory connects the stepwell with Queen Rudabai and the water routes of the old settlement."},
    {"title":"Rani ki Vav · Sample field note", "category":"stepwell", "era":"11th century", "place":"Rani ki Vav", "region":"Gujarat", "lat":23.8589, "lng":72.1019,
     "body":"At Patan, Rani ki Vav turns the act of drawing water into an architectural procession. Sculpted figures line the descending terraces. The monument records Solanki-era craft and a long relationship between water, ritual, and public life."},
    {"title":"Kutch weaving · Sample field note", "category":"craft", "era":"20th century", "place":"Bhuj", "region":"Gujarat", "lat":23.2420, "lng":69.6669,
     "body":"In Kutch, woven patterns carry family and village histories. A textile can mark migration, celebration, and the hands that made it. This sample note is included to demonstrate archive search across cultural material as well as monuments."},
]


def make_scan(index: int, title: str, body: str) -> Path:
    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    path = SAMPLE_DIR / f"field-note-{index}.png"
    if path.exists():
        return path
    image = Image.new("RGB", (1350, 900), "#eee9da")
    draw = ImageDraw.Draw(image)
    try:
        serif = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", 38)
        body_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", 29)
        small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
    except OSError:
        serif, body_font, small = (ImageFont.load_default(size=38), ImageFont.load_default(size=29),
                                  ImageFont.load_default(size=18))
    draw.rectangle((54, 54, 1296, 846), outline="#a69c83", width=3)
    draw.text((100, 102), "STHALASUTRA · SAMPLE ARCHIVE", font=small, fill="#726b59")
    draw.line((100, 145, 1250, 145), fill="#bcb39e", width=2)
    draw.text((100, 190), title, font=serif, fill="#2e3d32")
    y = 285
    for line in textwrap.wrap(body, width=66):
        draw.text((100, y), line, font=body_font, fill="#3f433b")
        y += 52
    draw.line((100, 735, 1250, 735), fill="#bcb39e", width=2)
    draw.text((100, 762), "SYNTHETIC FIELD NOTE · FOR OCR AND SEARCH DEMONSTRATION", font=small, fill="#786f5d")
    image.save(path)
    return path


def main():
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
        map_samples = [
            ("Sample stepwell study route", "route", "Gujarat", "Synthetic demonstration route linking two sample stepwell records.",
             "LINESTRING(72.5833 23.1667,72.1019 23.8589)", "Rani ki Vav · Sample field note"),
            ("Sample Kutch oral-history pin", "folklore", "Gujarat", "Synthetic folklore pin showing how a place-based oral-history record is linked to its source note.",
             "POINT(69.6669 23.2420)", "Kutch weaving · Sample field note"),
        ]
        for title, kind, region, description, wkt, artifact_title in map_samples:
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
