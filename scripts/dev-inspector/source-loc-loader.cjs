/* eslint-disable */
"use strict";

/**
 * Dev-only webpack/Turbopack loader that stamps host JSX elements with
 * `data-loc="<repo-relative-path>:LINE:COL"` for the in-app DevInspector
 * (press `;` then `i`).
 *
 * Why a loader (not React fiber walking): React 19 removed `_debugSource`, so
 * click-to-source has to be stamped at build time. We run a minimal Babel pass
 * — parse-only (jsx + typescript), our `inject-source-loc` plugin is the ONLY
 * transform — so the output is still TSX/JSX that Turbopack's own SWC pipeline
 * then lowers. This mirrors a webpack `enforce: 'pre'` loader: it runs before
 * Turbopack's built-in transforms.
 *
 * Cost-aware + safe: it is OPT-IN. The matching `turbopack.rules` entry is only
 * registered when `DEV_INSPECT=1` (see next.config.ts), and this loader also
 * re-checks the flag and short-circuits to a no-op otherwise — so a normal
 * `npm run dev` and every production build pay nothing and `@babel/core` is
 * never even required.
 */

let babel; // lazily required only when actually transforming

module.exports = function sourceLocLoader(source, inputMap, meta) {
  const callback = this.async();

  // Hard gate: do nothing unless explicitly launched in inspect mode.
  if (process.env.DEV_INSPECT !== "1") {
    return callback(null, source, inputMap, meta);
  }

  const resourcePath = (this.resourcePath || "").replace(/\\/g, "/");
  const base = resourcePath.slice(resourcePath.lastIndexOf("/") + 1);

  // Only our own .tsx/.jsx source — never dependencies or generated output.
  // Also skip Next's image-metadata routes (icon / apple-icon / opengraph-image
  // / twitter-image): they render through satori (ImageResponse), not the DOM,
  // so a `data-loc` attribute is meaningless there and can confuse the renderer.
  if (
    !/\.[jt]sx$/.test(resourcePath) ||
    resourcePath.includes("/node_modules/") ||
    resourcePath.includes("/.next/") ||
    /^(icon|apple-icon|opengraph-image|twitter-image)\d*\.[jt]sx$/.test(base)
  ) {
    return callback(null, source, inputMap, meta);
  }

  const opts =
    (typeof this.getOptions === "function" && this.getOptions()) || {};
  const rootDir = String(opts.rootDir || process.cwd()).replace(/\\/g, "/");

  // Repo-relative, forward-slashed path: `src/.../File.tsx` (or `app/...`).
  const relPath = resourcePath.startsWith(rootDir + "/")
    ? resourcePath.slice(rootDir.length + 1)
    : resourcePath.replace(/^.*\//, "");

  if (!babel) babel = require("@babel/core");
  const injectSourceLoc = require("./inject-source-loc.cjs");

  babel
    .transformAsync(source, {
      filename: resourcePath,
      configFile: false,
      babelrc: false,
      sourceMaps: true,
      // Parse-only flags (not transform presets) so Babel reads TS + JSX but
      // our plugin is the ONLY transform — JSX/types are left for SWC to lower.
      parserOpts: { plugins: ["jsx", "typescript"] },
      plugins: [[injectSourceLoc, { relPath }]],
    })
    .then((result) => {
      if (!result || result.code == null) {
        return callback(null, source, inputMap, meta);
      }
      callback(null, result.code, result.map || inputMap, meta);
    })
    .catch((err) => callback(err));
};
