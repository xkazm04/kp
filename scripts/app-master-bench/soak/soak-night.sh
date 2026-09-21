#!/usr/bin/env sh
# P3 soak — one night, scheduled by cron or a systemd timer (see
# docs/development/app-master-soak.md). POSIX twin of soak-night.cmd.
#
# The repo root is derived from THIS FILE's location, never hardcoded — the
# repo is public and a wired-in user path makes every stated failure mode
# unreachable off this machine.
#
# Exit 0 always, unless the RUNNER itself is missing: a failed night is a
# datapoint, and a scheduler that sees red every night teaches the operator
# to ignore it. night.mjs already exits 0 on a recorded miss.
#
# Env defaults match night.mjs when SOAK_* is unset:
#   SOAK_KP_URL        http://localhost:3103
#   SOAK_PERSONAS_URL  http://127.0.0.1:9420
#   SOAK_TENURE        kp-owner
#   SOAK_KP_DB         ${XDG_DATA_HOME:-$HOME/.local/share}/kp-bench/kp-soak.sqlite
#   SOAK_BACKLOG       <repo>/uat/value/backlog-2026-08-31.json

set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../../.." && pwd)
cd "$ROOT"

NIGHT="$ROOT/scripts/app-master-bench/soak/night.mjs"
if [ ! -f "$NIGHT" ]; then
  echo "soak-night.sh: $NIGHT is missing — the runner itself is missing" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "soak-night.sh: node is not on PATH — the runner itself is missing" >&2
  exit 1
fi

mkdir -p bench/app-master/soak

# set -eu is on; a non-zero from node is swallowed so a recorded miss cannot
# turn the timer red. Missing runner already exited 1.
node "$NIGHT" >> bench/app-master/soak/runner.log 2>&1 || true
exit 0
