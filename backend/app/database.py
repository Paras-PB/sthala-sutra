from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .settings import DATABASE_URL


class Base(DeclarativeBase):
    pass


engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"options": "-csearch_path=public,extensions"})
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def initialize_database() -> None:
    # Supabase and the local PostGIS image both provide these extensions.
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
