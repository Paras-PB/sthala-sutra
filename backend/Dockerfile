FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-guj poppler-utils fonts-dejavu-core libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models/huggingface
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app /app/app
COPY ml /app/ml
RUN useradd --create-home --shell /usr/sbin/nologin app \
    && mkdir -p /app/uploads /app/sample-data /models/huggingface \
    && chown -R app:app /app /models
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
