import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from pgvector.sqlalchemy import Vector
from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

CATEGORIES = ("stepwell", "fort", "craft", "temple", "other")


# Index names and definitions mirror supabase/migrations so local create_all
# builds the same schema as the hosted database.
class Place(Base):
    __tablename__ = "places"
    __table_args__ = (Index("ix_places_geom", "geom", postgresql_using="gist"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(240), nullable=False, unique=True)
    region: Mapped[str | None] = mapped_column(String(160))
    geom = mapped_column(Geometry("POINT", srid=4326, spatial_index=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    artifacts: Mapped[list["Artifact"]] = relationship(back_populates="place")


class Artifact(Base):
    __tablename__ = "artifacts"
    __table_args__ = (
        CheckConstraint("latitude IS NULL OR latitude BETWEEN -90 AND 90", name="artifacts_valid_latitude"),
        CheckConstraint("longitude IS NULL OR longitude BETWEEN -180 AND 180", name="artifacts_valid_longitude"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    media_type: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False, default="other")
    era: Mapped[str | None] = mapped_column(String(120))
    language: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued")
    progress: Mapped[str | None] = mapped_column(String(120))
    preview_path: Mapped[str | None] = mapped_column(String(1024))
    error_message: Mapped[str | None] = mapped_column(Text)
    place_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("places.id", ondelete="SET NULL"), index=True)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    place: Mapped[Place | None] = relationship(back_populates="artifacts")
    passages: Mapped[list["Passage"]] = relationship(back_populates="artifact", cascade="all, delete-orphan")


# Defined after the class so it can reference the column for the DESC ordering.
Index("ix_artifacts_created_at", Artifact.created_at.desc())


class Passage(Base):
    __tablename__ = "passages"
    __table_args__ = (
        Index("ix_passages_embedding", "embedding", postgresql_using="hnsw",
              postgresql_ops={"embedding": "vector_cosine_ops"}),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    artifact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("artifacts.id", ondelete="CASCADE"), index=True)
    page_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    original_text: Mapped[str] = mapped_column(Text, nullable=False)
    translated_text: Mapped[str | None] = mapped_column(Text)
    entities: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(384))
    artifact: Mapped[Artifact] = relationship(back_populates="passages")


class MapFeature(Base):
    __tablename__ = "map_features"
    __table_args__ = (
        CheckConstraint("feature_type IN ('monument', 'route', 'folklore')", name="map_features_valid_type"),
        Index("ix_map_features_geom", "geom", postgresql_using="gist"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    feature_type: Mapped[str] = mapped_column(String(24), nullable=False)
    region: Mapped[str | None] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, nullable=False)
    geom = mapped_column(Geometry("GEOMETRY", srid=4326, spatial_index=False), nullable=False)
    artifact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("artifacts.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
