import { disclosureComplianceFor } from "@/app/_lib/compliance-disclosure";
import { getOfferByToken } from "@/app/_lib/offers-store";
import { OfferClient } from "./OfferClient";

// Token-gated offer page — inherently per-request (reads the token, fetches the
// offer, renders under the per-request locale layout), so there is no useful
// static shell. Block it under Cache Components. `instant` is route segment
// config, so it lives on this Server Component wrapper; the interactive UI stays
// in the "use client" OfferClient child. (The sibling loading.tsx still provides
// the navigation loading state.)
export const instant = false;

export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  // Resolve the COMPLIANCE REGIME for the team that extended this offer, so the AI
  // disclosure the client renders names the right law. OfferClient is public and
  // session-less, so its own fetch of the gated, caller-scoped /api/compliance
  // could only ever have answered for the default workspace — see the header of
  // AiDisclosure.tsx. Only the workspace id is taken off the row here; the offer
  // itself still reaches the browser through GET /api/offer/[token]'s projection.
  const { token } = await params;
  const compliance = disclosureComplianceFor(getOfferByToken(token)?.workspaceId);
  return <OfferClient compliance={compliance} />;
}
