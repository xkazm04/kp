"use client";

/**
 * The production-safe boundary in front of {@link DevInspectorImpl} — a dev-only
 * "click a component, copy its source path" overlay (see DevInspectorImpl.tsx for
 * how to drive it).
 *
 * WHY THIS STUB EXISTS. The root layout mounts the inspector behind a literal
 * `process.env.NODE_ENV === "development" && <DevInspector />` gate
 * (app/layout.tsx), and the comment on the implementation used to claim that gate
 * kept the module "absent from production". It did not. The gate decides what is
 * RENDERED; it does not decide what is BUNDLED. A "use client" component named in
 * the layout's module graph becomes a client reference the router has to be able
 * to load, so the whole inspector — the DOM walker, the HUD, the highlight chrome
 * — was emitted into the production client build and listed in the root page's
 * client-reference manifest. Measured against a real `npm run build` on main
 * (2026-09-04): 20,253 bytes at `.next/static/chunks/<hash>.js`, reachable from
 * `.next/server/app/page_client-reference-manifest.js`. Twenty kilobytes of
 * devtools on the first paint of a marketing landing page, shipped to every
 * visitor, to render nothing.
 *
 * The fix is to make the module boundary itself conditional rather than the
 * element: this stub is all that stays in the eager graph, and the implementation
 * is reached through a dynamic `import()` inside a `NODE_ENV` branch. Bundlers
 * inline `process.env.NODE_ENV` at build time, so in production the branch folds
 * to `false` and the import is dead code; even where a bundler declines to drop
 * it, the chunk becomes lazy — requested only if that branch runs, which in
 * production it never does. Either way no production browser fetches it.
 *
 * KEEP IT THIS THIN. Anything imported here is imported by the whole app. New
 * inspector code belongs in DevInspectorImpl.tsx (or a module only it imports),
 * never beside this comment. `dev-inspector-bundle.test.ts` pins that.
 */

import { useEffect, useState, type ComponentType } from "react";

export function DevInspector() {
  // Held as state rather than rendered directly so the async import has somewhere
  // to land. `null` — the production value, forever — renders nothing.
  const [Impl, setImpl] = useState<ComponentType | null>(null);

  useEffect(() => {
    // The whole point of the file: the `import()` sits INSIDE the constant branch
    // so it can be folded away, not beside it.
    if (process.env.NODE_ENV !== "development") return;
    let live = true;
    void import("./DevInspectorImpl")
      .then((mod) => {
        // A resolve after unmount would set state on a dead component.
        if (live) setImpl(() => mod.DevInspectorImpl);
      })
      .catch((err: unknown) => {
        // Dev-only tool: a failed chunk load must never take the app down with it.
        // Logged rather than dropped silently — a developer who pressed `;` and got
        // nothing needs to know the module, not their keystroke, is what failed.
        console.warn("[dev-inspector] the inspector chunk did not load", err);
      });
    return () => {
      live = false;
    };
  }, []);

  return Impl ? <Impl /> : null;
}
