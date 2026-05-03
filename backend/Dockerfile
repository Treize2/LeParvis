FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libxml2-dev libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Chromium + the system libs Chromium needs (~400 MB to the image).
# Used only when an ingest request asks for JS rendering. Runs as root
# during build; runtime safety is enforced via --no-sandbox in the launcher.
RUN playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/*

COPY app/ ./app/

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

CMD ["sh", "-c", "python -m app.seed && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
