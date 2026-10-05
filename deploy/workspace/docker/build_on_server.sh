#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$project_root"
release_tag="$(python3 docker/verify_workspace.py --print-tag)"
builder="backgammon-build-${release_tag}"
compose=(sudo docker compose --env-file docker/production.env -f docker/compose.production.yaml --profile live)

"${compose[@]}" config --quiet
if ! sudo docker buildx inspect "$builder" >/dev/null 2>&1; then
  sudo docker buildx create --name "$builder" --driver docker-container \
    --driver-opt memory=3g,memory-swap=3g,cpu-period=100000,cpu-quota=100000,default-load=true,restart-policy=no \
    --buildkitd-config docker/buildkit.production.toml
fi
trap 'sudo docker buildx stop "$builder" || true' EXIT
sudo docker buildx inspect "$builder" --bootstrap
limits="$(sudo docker inspect "buildx_buildkit_${builder}0" --format '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.CpuPeriod}} {{.HostConfig.CpuQuota}}')"
if [ "$limits" != '3221225472 3221225472 100000 100000' ]; then
  printf '%s\n' 'Builder limits differ from the reviewed configuration; build stopped.' >&2
  exit 1
fi
for service in game-api tournaments-api analysis-api dice game-frontend tournaments-frontend admin-frontend; do
  printf '\nBuilding %s\n' "$service"
  "${compose[@]}" build --builder "$builder" "$service"
done
for image in game tournaments analysis dice game-frontend tournaments-frontend admin-frontend; do
  sudo docker image inspect "backgammon-production-${image}:${release_tag}" \
    --format '{{.RepoTags}} {{.Id}} {{.Os}}/{{.Architecture}}'
done
printf '%s\n' 'Seven production images built. Application services have not been started.'
