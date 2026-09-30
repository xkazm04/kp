import { transitionHiredAgent, type HiredAgentRecord } from "../db/agents";
import { retirePersonasPersona, type RetirePersonaResult } from "./personas-places";

/** Retire one gig persona's hire: the Personas persona first (when it has one), then the
 *  hire -> `retired`. True when the hire is now retired; false = deferred (Personas refused
 *  or could not be asked, or the hire moved) and a later pass retries it. A persona Personas
 *  no longer knows is retired in kp too. Shared by the sync's retire step (gigs/sync.ts) and
 *  the purge (gigs/purge.ts); a module of its own so the purge door does not import the sync. */
export async function retireGigPersonaHire(
  workspaceId: string,
  agent: HiredAgentRecord,
  reason: string,
  retirePersona: (personaId: string) => Promise<RetirePersonaResult> = (id) => retirePersonasPersona(id)
): Promise<boolean> {
  if (agent.personaId) {
    let res: RetirePersonaResult;
    try {
      res = await retirePersona(agent.personaId);
    } catch {
      // The default transport never throws; an injected one might - retried next pass.
      res = { ok: false, reason: "personas_unreachable" };
    }
    if (!res.ok && res.reason !== "personas_persona_missing") return false;
  }
  return transitionHiredAgent(agent.id, { from: agent.status, to: "retired", event: "gig_retired", reason }, workspaceId).applied;
}
