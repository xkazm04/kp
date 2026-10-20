@echo off
rem The fake Codex CLI (..\fake-codex.mjs) for e2e/gig-lifecycle.spec.ts, put first on PATH.
node "%~dp0..\fake-codex.mjs" %*
