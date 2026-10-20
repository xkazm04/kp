// The closed vocabularies a card words through the catalog (next-intl keys are typed, so a rung or an autopilot
// mode cannot be interpolated into a key). Pure, so the joins are pinned by workforceCopy.test.ts.
import type { AutopilotMode } from "@/app/_lib/agent-hire/report-payload.ts";

// The mandate ladder is closed at 0..2 (3 and 4 are never grantable), so the explicit map is the honest shape.
const RUNG_KEY = ["appMaster.rung.0", "appMaster.rung.1", "appMaster.rung.2"] as const;

export function rungKey(rung: number | null): (typeof RUNG_KEY)[number] | "appMaster.rung.unknown" {
  return rung != null && Number.isInteger(rung) && rung >= 0 && rung < RUNG_KEY.length ? RUNG_KEY[rung] : "appMaster.rung.unknown";
}

/** The autopilot mode Personas reports (closed: off / measure / suggest / full); none reported is stated, never guessed. */
export function autopilotKey(mode: AutopilotMode | null): "appMaster.autopilot.off" | "appMaster.autopilot.measure" | "appMaster.autopilot.suggest" | "appMaster.autopilot.full" | "wk.autopilotUnreported" {
  switch (mode) {
    case "off": return "appMaster.autopilot.off";
    case "measure": return "appMaster.autopilot.measure";
    case "suggest": return "appMaster.autopilot.suggest";
    case "full": return "appMaster.autopilot.full";
    default: return "wk.autopilotUnreported";
  }
}
