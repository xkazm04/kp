/* eslint-disable */
"use strict";

/**
 * Dev-only Babel plugin — stamps each HOST JSX element with a
 * `data-loc="<repo-relative-path>:LINE:COL"` attribute so the in-app
 * DevInspector (press `;` then `i`) can map a clicked DOM node back to its
 * source location and copy a Claude-Code-friendly `path:line` reference.
 *
 * Host-only by design: component (uppercase) JSX elements don't reliably
 * forward an injected prop to their root DOM node, and React 19 removed both
 * the Fiber `_debugSource` field and (in 19.2) the `jsxDEV` source/self args
 * the old click-to-component tools relied on. Stamping host elements and
 * walking the DOM ancestor chain at runtime is version-independent and needs
 * no React internals.
 *
 * The repo-relative path is computed by the loader and handed in via the
 * `relPath` plugin option (the loader is the only thing that knows the project
 * root + resource path), keeping this plugin layout-agnostic.
 *
 * Wired into Turbopack via `turbopack.rules` ONLY when `DEV_INSPECT=1` (set by
 * `npm run dev:inspect`), so the attribute never exists in a normal dev session
 * or any production build.
 *
 * @param {{ types: import('@babel/core').types }} babel
 * @param {{ relPath?: string }} options
 */
module.exports = function injectSourceLoc({ types: t }, options) {
  const ATTR = "data-loc";
  const relPath = options && options.relPath;

  return {
    name: "inject-source-loc",
    visitor: {
      JSXOpeningElement(path) {
        if (!relPath) return;

        const nameNode = path.node.name;
        // Host elements only: <div>, <button>, ... (a JSXIdentifier whose name
        // starts lowercase). Skip components (<Button>), member expressions
        // (<Foo.Bar>) and namespaced names.
        if (nameNode.type !== "JSXIdentifier") return;
        if (!/^[a-z]/.test(nameNode.name)) return;

        const loc = path.node.loc;
        if (!loc) return;

        // Idempotent: never double-stamp (e.g. if a file is transformed twice).
        const already = path.node.attributes.some(
          (a) => a.type === "JSXAttribute" && a.name && a.name.name === ATTR,
        );
        if (already) return;

        path.node.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier(ATTR),
            t.stringLiteral(`${relPath}:${loc.start.line}:${loc.start.column + 1}`),
          ),
        );
      },
    },
  };
};
