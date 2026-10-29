from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class PlaceOut(BaseModel):
    id: UUID
    name: str
    region: str | None


class ArtifactOut(BaseModel):
    id: UUID
    title: str
    original_filename: str
    media_type: str
    category: str
    era: str | None
    language: str | None
    status: str
    progress: str | None
    error_message: str | None
    latitude: float | None
    longitude: float | None
    created_at: datetime
    place: PlaceOut | None = None
    # First page only; the detail endpoint returns every page.
    original_text: str | None = None
    translated_text: str | None = None
    page_count: int
    image_url: str
    preview_url: str | None


class PageEntitiesOut(BaseModel):
    places: list[str]
    dates: list[str]
    category: str | None


class PageOut(BaseModel):
    page_number: int
    original_text: str
    translated_text: str | None
    entities: PageEntitiesOut


class ArtifactDetailOut(ArtifactOut):
    pages: list[PageOut]


class SearchHitOut(BaseModel):
    artifact: ArtifactOut
    original_text: str
    translated_text: str | None
    page_number: int
    score: float
    semantic_score: float
    distance_km: float | None


class MapArtifactOut(BaseModel):
    latitude: float
    longitude: float
    artifact: ArtifactOut


class MapFeatureOut(BaseModel):
    id: UUID
    title: str
    kind: str
    description: str
    geometry: dict
    artifact: ArtifactOut | None


class MapOut(BaseModel):
    artifacts: list[MapArtifactOut]
    features: list[MapFeatureOut]


class FacetsOut(BaseModel):
    regions: list[str]
    eras: list[str]
    categories: list[str]
