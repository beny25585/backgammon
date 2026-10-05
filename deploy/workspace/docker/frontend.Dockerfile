FROM node:24-bookworm-slim AS dependencies
ENV CI=true
RUN npm install --global pnpm@10.33.2
ARG APP_DIR
WORKDIR /app
# Include workspace overrides and package-manager configuration before installing.
COPY ["${APP_DIR}/", "/app/"]
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store

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
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY docker/nginx.frontend.conf /etc/nginx/conf.d/default.conf
