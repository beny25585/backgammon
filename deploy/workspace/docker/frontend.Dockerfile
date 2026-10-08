FROM node:24-bookworm-slim AS dependencies
ENV CI=true
RUN npm install --global pnpm@10.33.2
ARG APP_DIR
WORKDIR /app
# Include the lockfile and optional workspace overrides before installing.
# All three apps have pnpm-lock.yaml; pnpm-workspace.yaml is optional.
COPY ["${APP_DIR}/package.json", "${APP_DIR}/pnpm-*.yaml", "/app/"]
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY ["${APP_DIR}/", "/app/"]

FROM dependencies AS development
CMD ["pnpm", "exec", "vite", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]

# The production frontend build is an explicit, separate target.
FROM dependencies AS build
ARG VITE_SERVER_URL=/backgammon
ARG VITE_TOURNAMENTS_URL
ARG VITE_GAME_URL=/backgammon/
ENV VITE_SERVER_URL=$VITE_SERVER_URL VITE_TOURNAMENTS_URL=$VITE_TOURNAMENTS_URL VITE_GAME_URL=$VITE_GAME_URL
RUN pnpm run build

FROM nginx:1.28-alpine AS production
ARG SOURCE_REVISION=unversioned
ARG RELEASE_TAG=unversioned
LABEL org.opencontainers.image.revision=$SOURCE_REVISION io.backgammon.release=$RELEASE_TAG
COPY --from=build /app/dist/ /usr/share/nginx/html/
# Public assets copied from a private checkout can retain mode 0600.
# Nginx workers must be able to traverse directories and read every asset.
RUN find /usr/share/nginx/html -type d -exec chmod 0755 {} + \
    && find /usr/share/nginx/html -type f -exec chmod 0644 {} +
COPY docker/nginx.frontend.conf /etc/nginx/conf.d/default.conf
