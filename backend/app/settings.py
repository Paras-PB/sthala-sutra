import os
from pathlib import Path

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://heritage:heritage@localhost:5432/heritage")
BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(Path(__file__).resolve().parents[2] / "uploads")))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
CORS_ORIGINS = [v.strip() for v in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if v.strip()]
