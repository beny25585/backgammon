FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
ARG APP_DIR
WORKDIR /app
COPY ["${APP_DIR}/requirements.txt", "/tmp/requirements.txt"]
RUN pip install -r /tmp/requirements.txt
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --create-home app \
    && mkdir -p /data/static /data/media && chown -R app:app /data /app
COPY --chown=app:app ["${APP_DIR}/", "/app/"]
COPY docker/runtime_env.py docker/prepare_local.py /opt/docker/
COPY docker/tournaments_transfer.py docker/service_runtime.py /opt/docker/
USER app
ENTRYPOINT ["python", "/opt/docker/runtime_env.py"]

# Release metadata must not invalidate dependency or application layers.
ARG SOURCE_REVISION=unversioned
ARG RELEASE_TAG=unversioned
LABEL org.opencontainers.image.revision=$SOURCE_REVISION io.backgammon.release=$RELEASE_TAG
