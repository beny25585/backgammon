FROM python:3.12-slim-bookworm AS engine
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential cmake pkg-config ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /app
COPY backgammon-analysis-service/requirements*.txt ./
RUN pip install -r requirements-server.txt
COPY backgammon-analysis-service/scripts/install_open_sage.py scripts/install_open_sage.py
# Use the baseline build on both developer machines and production CPUs.
RUN python scripts/install_open_sage.py --compatible

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/opt/venv/bin:$PATH"
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app && useradd --uid 10001 --gid app --create-home app \
    && mkdir -p /app /data/static && chown -R app:app /app /data
COPY --from=engine /opt/venv /opt/venv
WORKDIR /app
COPY --chown=app:app backgammon-analysis-service/ /app/
COPY docker/runtime_env.py /opt/docker/runtime_env.py
USER app
ENTRYPOINT ["python", "/opt/docker/runtime_env.py"]
