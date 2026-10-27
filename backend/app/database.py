from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

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


def initialize_database() -> None:
    if not AUTO_CREATE_SCHEMA:
        required_tables = ("places", "artifacts", "passages", "map_features")
        with engine.begin() as conn:
            missing_tables = [name for name in required_tables
                              if conn.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{name}"}).scalar() is None]
            installed = {row[0] for row in conn.execute(
                text("SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'vector')")
            )}
        if missing_tables or installed != {"postgis", "vector"}:
            raise RuntimeError(
                "Database schema is incomplete. Apply the checked-in Supabase migrations before starting the API; "
                f"missing tables={missing_tables}, missing extensions={sorted({'postgis', 'vector'} - installed)}."
            )
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
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_places_geom ON places USING GIST (geom)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_passages_embedding ON passages USING hnsw (embedding vector_cosine_ops)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_map_features_geom ON map_features USING GIST (geom)"))
