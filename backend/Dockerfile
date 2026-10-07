FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Song Radar's audio decoder needs ffmpeg for recordings from both platforms.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/requirements-runtime.txt ./requirements-runtime.txt
RUN pip install -r requirements-runtime.txt

COPY backend/ ./
# Backend endpoints serve these shared Android/iOS assets by relative path.
COPY frontend/assets/ /app/frontend/assets/

RUN useradd --create-home --uid 10001 geobeats
USER geobeats

EXPOSE 8001
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port \"${PORT:-8001}\" --proxy-headers --no-access-log"]
