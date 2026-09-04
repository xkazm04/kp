import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl in "without i18n routing" mode: the locale is resolved per-request
// from the cookie/header in i18n/request.ts (no `[locale]` URL segment), which
// fits the ?tab=-driven single-page workspace without restructuring routing.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// --- Security headers (global) -----------------------------------------------
// Applied to every route via headers() below. These are the STATIC half — the
// same value for every request, so a build-time config can hold them.
//
// The Content-Security-Policy is NOT here. It carries a per-request nonce (the
// pre-paint THEME_INIT script in app/layout.tsx would otherwise force
// `'unsafe-inline'` into script-src, which is the allowance that makes a CSP
// roughly decorative), and a nonce can only be minted per request — so the whole
// policy lives in `buildCsp()` in proxy.ts and ships from there, report-only.
// Do not re-add a CSP to this list: two Content-Security-Policy headers on one
// response are two policies BOTH applying, and the intersection is not what
// either author wrote. `app/shell-headers.test.ts` pins that.
const SECURITY_HEADERS = [
  // 2 years, subdomains, preload-list eligible. Ignored by browsers over plain
  // http (dev), so it costs nothing locally and binds only real TLS deploys.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app embeds nothing and must not be embedded (clickjacking on the open
  // operator routes). DENY is the legacy half; the CSP in proxy.ts already
  // declares `frame-ancestors 'none'` for the browsers that read it (the
  // directive is ignored while the policy is report-only, so this header is what
  // actually enforces framing today).
  { key: "X-Frame-Options", value: "DENY" },
  // microphone=(self): the voice interview (/interview/[token]) calls
  // getUserMedia from this origin's own top-level documents — 'self' keeps that
  // working while denying the feature to any embedded third-party context.
  // Camera and geolocation are never used anywhere in the app.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  // `app/icon.svg` is served at `/icon.svg?<hash>` and linked from every
  // document — but a browser (and every RSS reader, link unfurler and crawler
  // ever written) still probes the well-known `/favicon.ico` root path on its
  // own, which this app answered with a 404 page. One redirect to the real icon,
  // temporary rather than permanent so swapping the icon convention later is not
  // fighting a 308 cached in every visitor's browser forever.
  //
  // The destination keeps the EXTENSION. A STATIC `app/icon.svg` serves at
  // `/icon.svg`; the bare `/icon` in Next's app-icons doc is the GENERATED
  // `icon.tsx` convention, which this app does not use — pointing there redirects
  // one 404 to another, which is what the first cut of this did until
  // `e2e/shell.spec.ts` was run against a production build.
  async redirects() {
    return [{ source: "/favicon.ico", destination: "/icon.svg", permanent: false }];
  },
  // `npm run dev:empty` (scripts/dev-empty.mjs, KP_EMPTY=1) runs a SECOND dev
  // server — the blank-tenant first-run preview — beside the normal seeded one.
  // Next's dev-server lock lives at <distDir>/lock, so the empty server needs its
  // own distDir to coexist (and its cache shouldn't share .next with the seeded
  // dev anyway). Production builds never set KP_EMPTY.
  ...(process.env.KP_EMPTY === "1" ? { distDir: ".next-empty" } : {}),
  // Standalone output — traces the exact server files + minimal node_modules into
  // .next/standalone (a self-contained `node server.js`), so the self-host Docker
  // image ships only what's needed instead of the whole source + full node_modules.
  // Slims the image ~3-4x. See docs/architecture/self-hosting.md + the Dockerfile. (better-sqlite3
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
// TURBOPACK is the default path, matching the rest of the repo (Next 16 runs
// Turbopack for `next dev` and `next build`; `--webpack` is the opt-OUT).
//
// This ran on webpack from 2026-06-18 to 2026-08-13. Turbopack executes JS
// loaders in Node subprocess workers, the rule was unconditional, and Windows
// does not cascade a kill down the process tree — so one `dev:inspect` run
// leaked ~2,800 parked node workers holding 15.8 GB. Two things changed since:
//   - `condition` on a Turbopack rule (new in Next 16.0) keeps the loader off
//     everything but this repo's own dev-mode JSX. `{ not: "foreign" }` excludes
//     node_modules AND Next's internals — the bulk of the module graph — so
//     those modules are never dispatched to a worker at all, rather than
//     dispatched and no-op'd inside the loader.
//   - scripts/dev-guard.mjs now reaps the whole tree (`taskkill /T /F`) on every
//     exit path and trips a circuit breaker at DEV_GUARD_MAX_NODE, so a storm
//     can neither survive the dev server nor run away while it is up.
//
// Measured on Windows when this moved back (2026-08-13), baseline 10 node procs:
// a COLD compile (turbopack cache wiped) of 22 routes peaked at 29, and 12
// consecutive HMR recompiles of a hot component held flat at 29 with no worker
// accumulation — against a breaker at 150 and an old failure mode of ~2,800.
// Output is identical between bundlers: 101 `data-loc` stamps on `/?tab=hiring`
// either way.
//
// `npm run dev:inspect:webpack` still selects the webpack branch further below
// as an escape hatch. Reach for it only if the Turbopack path misbehaves.
if (process.env.DEV_INSPECT === "1" && process.env.DEV_INSPECT_BUNDLER !== "webpack") {
  const loader = path.join(import.meta.dirname, "scripts", "dev-inspector", "source-loc-loader.cjs");
  // NOT restricted to the `browser` condition: a host element rendered by a
  // Server Component reaches the DOM through the RSC payload, so the server
  // compile has to be stamped too or server-rendered markup carries no data-loc.
  const inspectorRule: NonNullable<NonNullable<NextConfig["turbopack"]>["rules"]>[string] = {
    condition: { all: [{ not: "foreign" }, "development"] },
    loaders: [{ loader, options: { rootDir: import.meta.dirname } }],
  };
  // Merge — `turbopack.root` above is load-bearing for the loader's asset
  // filesystem (the app/*-icon metadata routes fail without it).
  nextConfig.turbopack = {
    ...nextConfig.turbopack,
    rules: { "*.tsx": inspectorRule, "*.jsx": inspectorRule },
  };
}

// The webpack escape hatch for the inspector — `npm run dev:inspect:webpack`
// (DEV_INSPECT_BUNDLER=webpack + `next dev --webpack`). Kept because this is the
// configuration that was proven storm-free on Windows for two months; see the
// history in the Turbopack block above. A `webpack` key present in the config
// makes `next build` fail fast under Turbopack, which is why it stays gated
// behind the env var rather than being registered unconditionally.
if (process.env.DEV_INSPECT === "1" && process.env.DEV_INSPECT_BUNDLER === "webpack") {
  const loader = path.join(import.meta.dirname, "scripts", "dev-inspector", "source-loc-loader.cjs");
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
