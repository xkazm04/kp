import { disclosureComplianceFor } from "@/app/_lib/compliance-disclosure";
import { getWorkspaceByStatusToken } from "@/app/_lib/application-status-store";
import { StatusClient } from "./StatusClient";

// Token-gated application-status page — inherently per-request (reads the token,
// fetches status, renders under the per-request locale layout), so there is no
// useful static shell. Block it under Cache Components. `instant` is route
// segment config, so it lives on this Server Component wrapper; the interactive
// UI stays in the "use client" StatusClient child. (The sibling loading.tsx
// still provides the navigation loading state.)
export const instant = false;

export default async function ApplicationStatusPage({ params }: { params: Promise<{ token: string }> }) {
  // The wrapper now does one thing besides declaring `instant`: resolve the
  // COMPLIANCE REGIME for the team that owns this status link, so the AI
  // disclosure the client renders names the right law. StatusClient is public and
  // session-less, so its own fetch of the gated, caller-scoped /api/compliance
  // could only ever have answered for the default workspace — see the header of
  // AiDisclosure.tsx. Only the workspace id is read here; the entry id behind the
  // token stays off the wire, as it always has.
  const { token } = await params;
  const compliance = disclosureComplianceFor(getWorkspaceByStatusToken(token));
  return <StatusClient compliance={compliance} />;
}
