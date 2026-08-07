import { OfferClient } from "./OfferClient";

// Token-gated offer page — inherently per-request (reads the token, fetches the
// offer, renders under the per-request locale layout), so there is no useful
// static shell. Block it under Cache Components. `instant` is route segment
// config, so it lives on this Server Component wrapper; the interactive UI stays
// in the "use client" OfferClient child. (The sibling loading.tsx still provides
// the navigation loading state.)
export const instant = false;

export default function OfferPage() {
  return <OfferClient />;
}
