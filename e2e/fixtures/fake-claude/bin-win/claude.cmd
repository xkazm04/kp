@echo off
rem The fake Claude CLI (..\fake-claude.mjs) for e2e/gig-lifecycle.spec.ts, put first on PATH.
node "%~dp0..\fake-claude.mjs" %*
