#!/usr/bin/env bash
set -euo pipefail
tools_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
python3 "$tools_dir/server_rehearsal.py" "$@" \
  --project "$HOME/backgammon-deploy/bg-20261005-git-r2" \
  --rehearsal "$HOME/backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal"
