"""Request validation that runs before any database access.

TestClient is used WITHOUT a `with` block, so the lifespan (initialize_database)
never runs and no Postgres is needed. Every request here must be rejected
before the endpoint touches the session.
"""
import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.main import _matches_signature, app

client = TestClient(app)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 "
PDF = b"%PDF-1.7\n"


def upload(content: bytes = PNG, filename: str = "scan.png", content_type: str = "image/png", **form):
    return client.post("/api/artifacts", files={"file": (filename, content, content_type)}, data=form)


@pytest.fixture(autouse=True)
def no_database(monkeypatch):
    """Fail loudly if a request that should be rejected early reaches the database."""
    def forbidden(*args, **kwargs):
        raise AssertionError("validation should reject this request before any database access")
    monkeypatch.setattr(main, "get_or_create_place", forbidden)
    monkeypatch.setattr(main, "embed_text", forbidden)


class TestUploadRejections:
    def test_wrong_content_type(self):
        response = upload(b"hello", filename="notes.txt", content_type="text/plain")
        assert response.status_code == 415

    def test_signature_does_not_match_content_type(self):
        response = upload(PDF, filename="scan.png", content_type="image/png")
        assert response.status_code == 415
        assert "contents" in response.json()["detail"]

    def test_empty_file(self):
        assert upload(b"").status_code == 415

    def test_extension_does_not_match_content_type(self):
        response = upload(PNG, filename="scan.pdf", content_type="image/png")
        assert response.status_code == 415
        assert "extension" in response.json()["detail"]

    @pytest.mark.parametrize("coordinates", [
        {"latitude": "23.0"},
        {"longitude": "72.5"},
        {"latitude": "91", "longitude": "72.5"},
        {"latitude": "23.0", "longitude": "-181"},
    ])
    def test_half_or_out_of_range_coordinates(self, coordinates):
        assert upload(**coordinates).status_code == 422

    def test_unsupported_category(self):
        response = upload(category="palace")
        assert response.status_code == 422
        assert "heritage type" in response.json()["detail"]

    def test_title_length_is_checked_after_stripping(self):
        assert upload(title="  " + "x" * 301 + "  ").status_code == 422

    def test_oversize_file(self, monkeypatch):
        monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 16)
        assert upload(PNG).status_code == 413


class TestSearchValidation:
    def test_lat_without_lon(self):
        assert client.get("/api/search", params={"q": "stepwell", "lat": 23.0}).status_code == 422

    def test_lon_without_lat(self):
        assert client.get("/api/search", params={"q": "stepwell", "lon": 72.5}).status_code == 422

    @pytest.mark.parametrize("params", [
        {"q": "s"},
        {"q": "stepwell", "lat": 95, "lon": 72.5},
        {"q": "stepwell", "lat": 23, "lon": 72.5, "radius_km": 0.5},
        {"q": "stepwell", "lat": 23, "lon": 72.5, "radius_km": 501},
        {"q": "stepwell", "limit": 51},
    ])
    def test_out_of_range_parameters(self, params):
        assert client.get("/api/search", params=params).status_code == 422


@pytest.mark.parametrize("content, media_type", [
    (JPEG, "image/jpeg"), (PNG, "image/png"), (WEBP, "image/webp"), (PDF, "application/pdf"),
])
def test_signature_matcher_accepts_real_headers(content, media_type):
    assert _matches_signature(content, media_type)


@pytest.mark.parametrize("content, media_type", [
    (PNG, "image/jpeg"),
    (JPEG, "image/png"),
    (b"RIFF\x00\x00\x00\x00WAVE", "image/webp"),
    (b"RIFF", "image/webp"),
    (b"PDF-1.7", "application/pdf"),
    (PNG, "text/plain"),
    (b"", "image/png"),
])
def test_signature_matcher_rejects_mismatches(content, media_type):
    assert not _matches_signature(content, media_type)
