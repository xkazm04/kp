"use client";

import dynamic from "next/dynamic";

// The first-run data choice behind a CLIENT-side code-split boundary. app/page.tsx
// serves three surfaces from one page, and every client component it reaches
// statically lands in the page's entry scripts, which every visitor downloads; this
// screen is shown once per install. A server-side next/dynamic does not split client
// components (Next's lazy-loading guide says so, and a measured build agreed), so the
// boundary is client to client. Still server-rendered (SSR stays on), and it has no
// nested lazy children, so there is no request waterfall to pay for it.
// docs/architecture/app-structure.md, "First load of '/'", has the measurement.
export const LazyFirstRunDataChoice = dynamic(() => import("./FirstRunDataChoice").then((m) => ({ default: m.FirstRunDataChoice })));
