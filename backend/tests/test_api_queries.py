"""Compile the hand-built queries to PostgreSQL SQL to catch construction errors without a database.

These check the SQL's shape, not its results; results need a running Postgres/PostGIS/pgvector.
"""
import uuid

from geoalchemy2.elements import WKTElement
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import insert

from app.main import apply_filters, page_summaries_statement, search_candidates_statement
from app.models import Artifact, MapFeature, Place

VECTOR = [0.0] * 384


def sql(stmt) -> str:
    return " ".join(str(stmt.compile(dialect=postgresql.dialect())).split())


def test_page_summaries_use_distinct_on_and_skip_embeddings():
    compiled = sql(page_summaries_statement([uuid.uuid4()]))
    assert "SELECT DISTINCT ON (passages.artifact_id)" in compiled
    assert "count(*) OVER (PARTITION BY passages.artifact_id)" in compiled
    assert "ORDER BY passages.artifact_id, passages.page_number" in compiled
    assert "embedding" not in compiled


def test_filters_apply_only_when_given():
    base = select(Artifact).outerjoin(Place, Artifact.place_id == Place.id)
    assert "WHERE" not in sql(apply_filters(base, None, None, None))
    compiled = sql(apply_filters(base, "Gujarat", "fort", "15th"))
    assert "places.region ILIKE" in compiled
    assert "artifacts.category =" in compiled
    assert "artifacts.era ILIKE" in compiled


def test_filters_can_target_map_feature_region():
    stmt = select(MapFeature).outerjoin(Artifact, MapFeature.artifact_id == Artifact.id)
    compiled = sql(apply_filters(stmt, "Kutch", None, None, region_column=MapFeature.region))
    assert "map_features.region ILIKE" in compiled
    assert "places.region" not in compiled


def test_search_without_geo_has_no_spatial_terms():
    compiled = sql(search_candidates_statement(VECTOR, None, None, None, candidate_limit=100))
    assert "<=>" in compiled  # pgvector cosine distance operator
    assert "ST_DWithin" not in compiled
    assert "distance_km" not in compiled
    assert "ORDER BY passages.embedding <=> %(embedding_1)s LIMIT" in compiled


def test_search_with_geo_filters_by_radius_and_reports_distance():
    compiled = sql(search_candidates_statement(VECTOR, "Gujarat", None, None, candidate_limit=100,
                                               lat=23.0, lon=72.5, radius_km=25.0))
    # Artifact point first, place point as the fallback, both as geography (metres).
    artifact_point = "geography(coalesce(ST_SetSRID(ST_MakePoint(artifacts.longitude, artifacts.latitude)"
    assert artifact_point in compiled
    assert "places.geom))" in compiled
    assert "WHERE passages.embedding IS NOT NULL AND places.region ILIKE" in compiled
    assert f"ST_DWithin({artifact_point}" in compiled
    assert "ST_Distance(" in compiled and "AS distance_km" in compiled


def test_place_insert_ignores_duplicate_names():
    stmt = (insert(Place).values(id=uuid.uuid4(), name="Adalaj", region="Gujarat",
                                 geom=WKTElement("POINT(72.58 23.17)", srid=4326))
            .on_conflict_do_nothing(index_elements=["name"]))
    compiled = sql(stmt)
    assert "INSERT INTO places (id, name, region, geom)" in compiled
    assert "ST_GeomFromEWKT(" in compiled
    assert compiled.endswith("ON CONFLICT (name) DO NOTHING")
