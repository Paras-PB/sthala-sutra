"""The models must build the same schema as supabase/migrations (compiled, no database)."""
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from app.database import Base
from app import models  # noqa: F401  (registers the tables on Base.metadata)


def _ddl() -> str:
    dialect = postgresql.dialect()
    statements = []
    for table in Base.metadata.sorted_tables:
        statements.append(str(CreateTable(table).compile(dialect=dialect)))
        statements.extend(str(CreateIndex(index).compile(dialect=dialect)) for index in table.indexes)
    return "\n".join(" ".join(statement.split()) for statement in statements)


def test_indexes_match_migrations():
    ddl = _ddl()
    assert "CREATE INDEX ix_artifacts_place_id ON artifacts (place_id)" in ddl
    assert "CREATE INDEX ix_artifacts_created_at ON artifacts (created_at DESC)" in ddl
    assert "CREATE INDEX ix_passages_artifact_id ON passages (artifact_id)" in ddl
    assert "CREATE INDEX ix_places_geom ON places USING gist (geom)" in ddl
    assert "CREATE INDEX ix_map_features_geom ON map_features USING gist (geom)" in ddl
    assert "CREATE INDEX ix_map_features_artifact_id ON map_features (artifact_id)" in ddl
    assert "CREATE INDEX ix_passages_embedding ON passages USING hnsw (embedding vector_cosine_ops)" in ddl


def test_artifact_constraints_and_new_columns():
    ddl = _ddl()
    assert "CONSTRAINT artifacts_valid_latitude CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90)" in ddl
    assert "CONSTRAINT artifacts_valid_longitude CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)" in ddl
    assert "progress VARCHAR(120)" in ddl
    assert "preview_path VARCHAR(1024)" in ddl


def test_geometry_columns_do_not_get_a_second_automatic_index():
    # geoalchemy2 would add idx_<table>_geom unless spatial_index=False.
    assert "idx_places_geom" not in _ddl()
    assert "idx_map_features_geom" not in _ddl()
