from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .settings import AUTO_CREATE_SCHEMA, DATABASE_URL, DB_MAX_OVERFLOW, DB_POOL_SIZE


class Base(DeclarativeBase):
    pass


engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    pool_timeout=30,
    pool_recycle=1800,
    connect_args={"options": "-csearch_path=public,extensions"},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

# Columns added after the first migration; a database that lacks them is out of date.
LATEST_ARTIFACT_COLUMNS = ("progress", "preview_path")
LATEST_MIGRATION = "supabase/migrations/20261029120000_add_artifact_progress_and_preview.sql"


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, always closed afterwards."""
    with SessionLocal() as db:
        yield db


def initialize_database() -> None:
    if not AUTO_CREATE_SCHEMA:
        _verify_migrated_schema()
        return

    # Local development bootstrap only. Hosted databases use checked-in migrations;
    # doing DDL on every replica startup risks locks and requires elevated privileges.
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        for table in ("places", "artifacts", "passages", "map_features"):
            conn.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
        # create_all never alters existing tables, so upgrade older local volumes here.
        conn.execute(text("ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS progress varchar(120)"))
        conn.execute(text("ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS preview_path varchar(1024)"))


def _verify_migrated_schema() -> None:
    required_tables = ("places", "artifacts", "passages", "map_features")
    with engine.begin() as conn:
        missing_tables = [name for name in required_tables
                          if conn.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{name}"}).scalar() is None]
        installed = {row[0] for row in conn.execute(
            text("SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'vector')")
        )}
        present_columns = {row[0] for row in conn.execute(
            text("SELECT column_name FROM information_schema.columns "
                 "WHERE table_schema = 'public' AND table_name = 'artifacts'")
        )}
    if missing_tables or installed != {"postgis", "vector"}:
        raise RuntimeError(
            "Database schema is incomplete. Apply the checked-in Supabase migrations before starting the API; "
            f"missing tables={missing_tables}, missing extensions={sorted({'postgis', 'vector'} - installed)}."
        )
    missing_columns = [name for name in LATEST_ARTIFACT_COLUMNS if name not in present_columns]
    if missing_columns:
        raise RuntimeError(
            f"Database schema is out of date: artifacts is missing columns {missing_columns}. "
            f"Apply {LATEST_MIGRATION} before starting the API."
        )
