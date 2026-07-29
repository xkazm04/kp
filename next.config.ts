import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl in "without i18n routing" mode: the locale is resolved per-request
// from the cookie/header in i18n/request.ts (no `[locale]` URL segment), which
// fits the ?tab=-driven single-page workspace without restructuring routing.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // `npm run dev:empty` (scripts/dev-empty.mjs, KP_EMPTY=1) runs a SECOND dev
  // server — the blank-tenant first-run preview — beside the normal seeded one.
  // Next's dev-server lock lives at <distDir>/lock, so the empty server needs its
  // own distDir to coexist (and its cache shouldn't share .next with the seeded
  // dev anyway). Production builds never set KP_EMPTY.
  ...(process.env.KP_EMPTY === "1" ? { distDir: ".next-empty" } : {}),
  // Standalone output — traces the exact server files + minimal node_modules into
  // .next/standalone (a self-contained `node server.js`), so the self-host Docker
  // image ships only what's needed instead of the whole source + full node_modules.
  // Slims the image ~3-4x. See docs/SELF_HOSTING.md + the Dockerfile. (better-sqlite3
  // is externalized below; its native binding is traced into the standalone bundle.)
  output: "standalone",
  // Ship the committed PlantUML sources into the standalone bundle. The
  // /diagrams (Architecture) page reads docs/diagrams/*.puml from disk at request
  // time via readFileSync(join(process.cwd(), "docs/diagrams", …)). Because that
  // read is dynamic (not an `import`), Next's static file-tracing cannot see it,
  // so under output:"standalone" the docs/ tree is never traced into
  // .next/standalone and the runner has no .puml files — every diagram renders
  // "Could not read …" in production (masked in `next dev`, where the source tree
  // is present). This include copies them to <standalone-root>/docs/diagrams/*,
  // where process.cwd() resolves them at runtime. Survives a plain `next build`
  // with no Dockerfile dependency. Keys are matched against route paths; the
  // Architecture page is /diagrams.
  outputFileTracingIncludes: {
    "/diagrams": ["./docs/diagrams/*.puml"],
  },
  // Instant Navigations (Next 16.3) — "instant routing". cacheComponents flips
  // the app to dynamic-by-default with no implicit caching; any route that
  // awaits data must then Stream (<Suspense>), Cache ('use cache'), or Block
  // (`export const instant = false`) or it becomes a dev error. partialPrefetching
  // makes prefetch send one reusable shell per route instead of one per link.
  // Both are top-level (not under experimental) as of 16.3 and are slated to
  // become defaults in a future major. See docs/INSTANT_NAVIGATIONS.md.
  cacheComponents: true,
  partialPrefetching: true,
  // This project sits in a multi-app workspace with a parent-level lockfile; pin
  // the Turbopack root to this directory so module resolution (and the
  // DevInspector loader's asset filesystem) stay scoped to the app rather than
  // the inferred parent. Without this, `npm run dev:inspect` fails on the
  // app/*-icon metadata routes ("needs to be on project filesystem").
  turbopack: {
    root: import.meta.dirname,
  },
  // better-sqlite3 is a native (N-API) module. Keep it EXTERNAL in every server
  // compile — the Node runtime AND the edge compile of instrumentation.ts, which
  // dynamically imports the sqlite-backed stores (offers-store → db-path →
  // better-sqlite3). Without this the bundler follows better-sqlite3's require()
  // chain into `fs`/native bindings; in a non-Node target there is no `fs`, so it
  // fails with "Can't resolve 'fs'" (surfaced on the webpack `dev:inspect` path).
  // The NEXT_RUNTIME !== "nodejs" guard in instrumentation.ts stops the code from
  // ever EXECUTING off-Node; this stops it from being BUNDLED there. Honored by
  // both Turbopack and webpack, so it fixes `dev`, `dev:inspect`, and `build`.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: {
      // Server Action request-body ceiling — this bounds POSTs to "use server"
      // functions ONLY. The file-upload Route Handlers (/api/analyze,
      // /api/extract-text) are not Server Actions, so this does NOT gate them;
      // they enforce the one per-file max-input contract (MAX_FILE_BYTES, 8 MB,
      // rejected at intake with HTTP 413) defined in
      // app/_lib/upload-constraints.ts. 10mb is held a step above that 8 MB
      // per-file limit so any future Server-Action upload path still clears one
      // max-size document plus multipart overhead. If you raise MAX_FILE_MB
      // past ~9, raise this too. (idea-36cc4b87)
      bodySizeLimit: "10mb"
    }
  }
};

// DevInspector — dev-only source-location stamping (press `;` then `i`, then
// right-click a component to copy its `app/.../File.tsx:LINE`). Opt-in: the
// loader is only registered when launched via `npm run dev:inspect` (which sets
// DEV_INSPECT=1), so a normal `npm run dev` and every production build are
// completely unaffected. See scripts/dev-inspector/.
//
// Registered through WEBPACK (`enforce: 'pre'`), NOT Turbopack. Turbopack runs
// JS loaders in Node subprocess workers that over-spawn and orphan on Windows:
// on 2026-06-18 a `dev:inspect` run leaked ~2,800 parked node workers (15.8 GB)
// because the dev server's loader workers were never reaped. webpack's loader
// pipeline runs in-process and is bounded, so the inspector is storm-free.
// `npm run dev:inspect` therefore launches `next dev --webpack` (see
// package.json) to select this path. Under Turbopack this rule is never
// registered at all, so the inspector simply no-ops instead of storming
// (fail-safe) if someone runs DEV_INSPECT=1 without --webpack.
if (process.env.DEV_INSPECT === "1") {
  const loader = path.join(process.cwd(), "scripts", "dev-inspector", "source-loc-loader.cjs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nextConfig.webpack = (config: any, context: any) => {
    config.module = config.module || { rules: [] };
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /\.[jt]sx$/,
      exclude: /[\\/]node_modules[\\/]/,
      enforce: "pre",
      use: [{ loader, options: { rootDir: process.cwd() } }],
    });
    // Webpack DEV does not tree-shake the NEXT_RUNTIME-guarded dynamic import in
    // instrumentation.ts (DCE is off in dev), so the EDGE compile of the
    // instrumentation hook chases its Node-only body (instrumentation-node.ts →
    // SQLite stores, python-runner's node:child_process, …) into Node builtins
    // that don't exist off-Node ("Can't resolve 'fs'", "node:child_process" …).
    // The body never RUNS on edge (the guard returns first), so drop the whole
    // module from the non-Node compile in one shot. (Turbopack `dev` + production
    // builds prune the dead import already; this only runs under DEV_INSPECT=1.)
    if (context?.nextRuntime !== "nodejs" && context?.webpack) {
      config.plugins = config.plugins || [];
      config.plugins.push(new context.webpack.IgnorePlugin({ resourceRegExp: /instrumentation-node$/ }));
    }
    return config;
  };
}

export default withNextIntl(nextConfig);
