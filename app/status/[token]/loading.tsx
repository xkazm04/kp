import { RouteLoading } from "@/app/_components/RouteLoading";

// Route-level loading fallback for /status/[token] — provides the Suspense
// boundary that lets this "use client" segment prerender an instant static shell
// under Cache Components while the per-request layout (locale) and the client
// bundle stream in. Without a boundary the shared layout's cookie-based locale
// read blocks the prerender entirely.
//
// The "page" variant, not "card": StatusClient's root is
// `mx-auto max-w-xl px-4 py-12` — byte-identical to RouteLoading's page
// geometry — whereas "card" is a vertically-centred `min-h-screen` panel (the
// offer/[token] shape). Under "card" the candidate saw a full-screen centred
// skeleton and then watched the whole page jump to a top-aligned narrow column
// the moment StatusClient mounted, which is the exact reflow these fallbacks
// exist to prevent.
export default function Loading() {
  return <RouteLoading variant="page" />;
}
