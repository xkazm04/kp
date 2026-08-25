# DevInspector — click a component, copy its source path

A dev-only overlay for grabbing a component's `app/.../File.tsx:line` and pasting it
straight into an AI coding CLI (Claude Code, etc.). Off by default; never present in
production builds.

```bash
npm run dev:inspect   # dev server with source-location stamping on
npm run dev:empty     # the empty-tenant server — inspector on by default
```

In the app, press **`;`** (enters keyboard mode) then **`i`** (Inspect) to arm it.
Hover highlights the element under the cursor and pins a `File.tsx:line` chip;
**right-click** copies the call-site path, **Alt+right-click** copies the innermost
element, click a HUD row to copy any enclosing file, and **Esc** exits. A plain
`npm run dev` works too, but the HUD will say source mapping is OFF until you
relaunch with `npm run dev:inspect` — `npm run dev:empty` carries the same stamping
(it exists to look at first-run UI on a throwaway empty DB; `-- --no-inspect` turns
it off for faster compiles). A gated Turbopack loader (`scripts/dev-inspector/`)
stamps host JSX with `data-loc` only when `DEV_INSPECT=1`; the overlay
(`app/_dev-inspector/`) reads it at runtime. Both are absent from production.

The loader runs on **Turbopack**, like every other command here. It briefly ran on
webpack after a 2026-06-18 worker-storm incident; a rule `condition` (Next 16) now
keeps it off `node_modules` and Next internals, which was the cause.
`npm run dev:inspect:webpack` is the escape hatch if the Turbopack path ever
misbehaves — same stamps, slower compile. See the comment in `next.config.ts`, and
`scripts/dev-guard.mjs` for the process-tree reaper that makes a repeat of that
incident impossible regardless of bundler (Next allows one dev server per checkout;
the lock is `.next/dev/lock`).
