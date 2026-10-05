FROM elixir:1.17.3-otp-26 AS build
ENV MIX_ENV=dev
WORKDIR /app
RUN mix local.hex --force && mix local.rebar --force
COPY ["Backgammon Game/dice_service/mix.exs", "Backgammon Game/dice_service/mix.lock", "/app/"]
RUN mix deps.get && mix deps.compile
COPY ["Backgammon Game/dice_service/config/", "/app/config/"]
COPY ["Backgammon Game/dice_service/lib/", "/app/lib/"]
RUN mix compile && mix release --path /opt/release

FROM debian:bookworm-slim
ENV LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
    libstdc++6 libncurses6 libtinfo6 libssl3 libsctp1 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home app
WORKDIR /app
COPY --from=build --chown=app:app /opt/release/ /app/
USER app
CMD ["bin/dice_service", "start"]
