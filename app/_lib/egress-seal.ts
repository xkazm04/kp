/**
 * THE EGRESS SEAL — one gate, checked before the network at every outbound boundary
 * that speaks to an outside party about a candidate: the comms relay, the ATS mirror,
 * the calendar edge, the pull pass and the two probe routes.
 *
 * `KP_NO_COMMS_EGRESS=1` answers one question: may this process speak to any outside
 * party about a candidate? It exists for a process that runs the REAL product code
 * against a COPY of a real database (the goal-1 demo run, scripts/kpi/role-demo-run.mjs):
 * that copy carries the operator's own relay, ATS and calendar configuration, and the
 * process inherits their environment. "No send call exists on this path today" is a fact
 * about today's call graph, not a guarantee; this is the guarantee.
 *
 * It is deliberately NOT KP_OFFLINE: that seals ALL egress, including the Claude CLI the
 * simulated interview needs, so a run under it would measure nothing.
 *
 * What a sealed boundary answers is its own "no information" shape, never a failure: a
 * sealed ATS delivery stays queued (no attempt counted), a sealed calendar read is
 * unknown, a sealed probe says `sealed`, a sealed pull skips its sources. Each such
 * answer is distinct from "not configured".
 */
export function egressSealed(env: Readonly<Partial<NodeJS.ProcessEnv>> = process.env): boolean {
  return env.KP_NO_COMMS_EGRESS === "1";
}

/** The word a sealed boundary reports in a probe or status response. */
export const SEALED = "sealed" as const;
