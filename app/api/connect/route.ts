import { NextResponse } from "next/server";
import { listConnectors } from "@/app/_lib/connect/catalog";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";

// The connector catalog, aggregated: one row per connector with its fields (a secret is
// `hasSecret`, never the value), ONE health word, lastOkAt / lastFailure and the egress
// class. A READ — it consults the stores and the in-process probe memory and makes 0
// network calls, so it is as cheap sealed as open and a keyless checkout answers every row
// `not_configured`. Probing is a separate act (connect/catalog.ts probeConnector).
//
// OPERATOR-only, like the settings doors it summarizes (/api/comms/relay, /api/ats/*):
// the rows describe where candidate data goes. Workspace-scoped because the calendar
// grant is per workspace; the relay and ATS rows are installation-level, as they are there.
export const GET = withWorkspace(async (ws: string) => {
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json({ connectors: listConnectors(ws) });
});
