FROM python:3.11-slim

WORKDIR /app

# Install system deps in two waves:
# 1. Build / lxml deps.
# 2. Runtime libs Chromium needs (Playwright's `--with-deps` would try to
#    install the legacy `ttf-unifont` and `ttf-ubuntu-font-family` packages
#    which were renamed on Debian 12, so we list the deps explicitly).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libxml2-dev libxslt1-dev \
    libnss3 libnspr4 \
    libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 \
    libxcb1 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    fonts-liberation fonts-unifont \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Chromium binary only (no apt step — already done above).
RUN playwright install chromium

COPY app/ ./app/

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

CMD ["sh", "-c", "python -m app.seed && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
