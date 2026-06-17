# Start the local LightTrack observability server for kp dev (docs/LLM_PROVIDER_LAYER.md).
#
#   pwsh scripts/lighttrack-dev.ps1
#
# Runs the LightTrack API (sibling repo ../LightTrack) in dev auth mode on
# 127.0.0.1:8787 with a SQLite store — foreground, like `npm run dev`, so keep
# it in its own terminal. kp's pipeline/jobfit/llm/monitor.py emits LLM events
# here whenever LIGHTTRACK_URL is set in kp's .env (the recipe is in .env.example).
#
# Production wiring is deliberately deferred until the product grows — this is a
# local-development convenience only.

$ErrorActionPreference = "Stop"

# ../LightTrack relative to this repo (scripts/ -> repo root -> sibling).
$repoRoot = Split-Path -Parent $PSScriptRoot
$ltRoot = Join-Path (Split-Path -Parent $repoRoot) "LightTrack"
if (-not (Test-Path $ltRoot)) {
  Write-Error "LightTrack repo not found at $ltRoot — clone it beside kp or adjust this path."
}

# Prefer a release build, fall back to debug, else build via cargo.
$candidates = @(
  (Join-Path $ltRoot "target\release\lighttrack-api.exe"),
  (Join-Path $ltRoot "target\debug\lighttrack-api.exe")
)
$bin = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

Push-Location $ltRoot
try {
  if ($bin) {
    Write-Host "Starting LightTrack: $bin" -ForegroundColor Cyan
    Write-Host "  → http://127.0.0.1:8787  (dev auth, SQLite)   Ctrl+C to stop" -ForegroundColor DarkGray
    & $bin
  } else {
    Write-Host "No prebuilt binary — running 'cargo run -p lighttrack-api' (first build is slow)…" -ForegroundColor Yellow
    cargo run -p lighttrack-api
  }
} finally {
  Pop-Location
}
