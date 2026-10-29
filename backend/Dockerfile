FROM python:3.11-slim
# fonts-noto-core + libfribidi0: the seed renders Gujarati/Devanagari samples with Pillow's
# Raqm layout (its wheels bundle libraqm but load FriBiDi at runtime). No compiler is needed:
# psycopg[binary] bundles libpq and every dependency ships cp311 manylinux wheels.
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-guj \
        poppler-utils fonts-dejavu-core fonts-noto-core libfribidi0 \
    && rm -rf /var/lib/apt/lists/*
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models/huggingface
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
# This image runs on CPU-only hosts. Install the official CPU wheel first so
# the general requirements file doesn't pull several gigabytes of CUDA wheels.
RUN pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        --extra-index-url https://pypi.org/simple \
        "torch==2.14.1+cpu" \
    && pip install --no-cache-dir -r requirements.txt
ENV PYTHONPATH=/app
COPY backend/app /app/app
COPY ml /app/ml
RUN useradd --create-home --shell /usr/sbin/nologin app \
    && mkdir -p /app/uploads /app/sample-data /models/huggingface \
    && chown -R app:app /app /models
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
