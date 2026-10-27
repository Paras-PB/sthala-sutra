import os
from pathlib import Path


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be a boolean value (true/false).")


DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://heritage:heritage@localhost:5432/heritage").strip()
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must be set to the application database connection URL.")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL.removeprefix("postgres://")
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL.removeprefix("postgresql://")
APP_ENV = os.getenv("APP_ENV", "development").strip().lower() or "development"
AUTO_CREATE_SCHEMA = _env_bool("AUTO_CREATE_SCHEMA", APP_ENV not in {"production", "prod"})
DB_POOL_SIZE = max(1, int(os.getenv("DB_POOL_SIZE", "5")))
DB_MAX_OVERFLOW = max(0, int(os.getenv("DB_MAX_OVERFLOW", "10")))
BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0").strip() or "redis://localhost:6379/0"
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(Path(__file__).resolve().parents[2] / "uploads")))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = max(1, int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024))))
CORS_ORIGINS = [v.strip() for v in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if v.strip()]
