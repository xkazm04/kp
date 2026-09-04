# Lessons — motionize

## 1.0 — 2026-09-04 — kp (perfect lot MZ)
- The only unskippable visual gate (the dual-theme contact sheet) crashed on the committed glyph folder because its file filter also matched `glyphData.test.ts`; nothing ran it, so nobody noticed. Fixed by filtering on `Glyph.ts`, and the fixtures now run under the repo's `npm run test:skills` CI row.
- `trace.mjs --emit` silently dropped `--slab-min-area`; all three CLIs now map options through one `glyphOptionsFromArgs`, source-pinned.
- The sheet renderer re-typed both palettes by eye; it now reads `app/globals.css`'s `@theme` block (not `:root` — Tailwind 4) and imports `snapToToken`. A mutation test proves the palette is read, not copied.
- Deps were carets with the lockfile ignored, so regeneration was undefined; pinned + lockfile committed, `npm ci` documented.
- Owner call still open: `openai-image.mjs` (dead by the skill's own admission) and `tight-crop.mjs` (unreferenced) — keep or delete.
