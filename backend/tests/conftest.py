"""Test settings, applied before any test module imports the app.

app.settings reads the environment at import time, so these must be set here,
at conftest import, rather than inside a fixture. create_engine and Celery are
both lazy, so the dummy URLs below never open a connection.
"""
import os
import tempfile

os.environ["UPLOAD_DIR"] = tempfile.mkdtemp(prefix="sthala-test-uploads-")
os.environ["DATABASE_URL"] = "postgresql+psycopg://test:test@localhost:5432/sthala_test"
os.environ["CELERY_BROKER_URL"] = "memory://"
