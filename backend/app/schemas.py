from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict


class PlaceOut(BaseModel):
    id: UUID
    name: str
    region: str | None
    latitude: float | None = None
    longitude: float | None = None
    model_config = ConfigDict(from_attributes=True)


class ArtifactOut(BaseModel):
    id: UUID
    title: str
    original_filename: str
    media_type: str
    category: str
    era: str | None
    language: str | None
    status: str
    error_message: str | None
    latitude: float | None
    longitude: float | None
    created_at: datetime
    place: PlaceOut | None = None
    original_text: str | None = None
    translated_text: str | None = None
    image_url: str
