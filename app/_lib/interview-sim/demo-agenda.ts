// The role demo's SHORT AGENDA (ADR-0011 amendment 2026-10-06, "Short agenda, same spend").
//
// The demo plays each interview inside DEMO_SIM_LIMITS (8 candidate turns). The real kit
// agenda — a warm-up, several scored topics with must-asks, role questions, a close — cannot
// be covered in 8 turns, so every simulated call ended `max_turns` and clause (ii) of the
// goal-1 verdict could never pass. This reduces the kit to what 8 turns can cover AND close:
// ONE scored block (the kit's first topic) with a capped number of must-asks, then the
// closing blocks. The director, the engine and the real kit builder are untouched; the
// director still refuses a `complete` while the one scored block is uncovered, so a protocol
// end on this agenda still means that block was covered.
//
// DEMO PATH ONLY. Nothing outside interview-sim/role-demo.ts may call this: a live interview
// is booked and run on the real agenda. The result is marked (`demoAgenda`) so a row and the
// goal-1 headline can say which agenda a call ran on — the shared InterviewAgenda type is not
// widened.

import { HARD_CAP_FACTOR } from "../interview-agenda";
import type { InterviewKit } from "../interview-agenda";
import type { AgendaBlock } from "../voice/director-types";

/** The label a demo interview row and the goal-1 headline carry for this agenda. */
export const SHORT_DEMO_AGENDA = "short-demo";

/** Must-asks (or, with none, questions) kept on the one scored block. */
export const SHORT_DEMO_MAX_MUST_ASKS = 2;
/** Minutes the one scored block may budget. */
export const SHORT_DEMO_TOPIC_MIN = 4;

export type ShortDemoKit = InterviewKit & { demoAgenda: typeof SHORT_DEMO_AGENDA };

/** The kit cut down to one scored block plus the closing blocks. Pure; never mutates `kit`. */
export function shortDemoAgenda(kit: InterviewKit): ShortDemoKit {
  const scored = kit.agenda.blocks.find((b) => b.kind === "topic") ?? kit.agenda.blocks.find((b) => b.scored);
  const closing = kit.agenda.blocks.filter((b) => b.kind === "role_qa" || b.kind === "close");
  const kept: AgendaBlock[] = [];
  if (scored) {
    const mustAsks = scored.mustAsks?.slice(0, SHORT_DEMO_MAX_MUST_ASKS);
    const questions = mustAsks?.length
      ? mustAsks.map((m) => m.text)
      : scored.questions.slice(0, SHORT_DEMO_MAX_MUST_ASKS);
    const block: AgendaBlock = { ...scored, budgetMin: Math.min(scored.budgetMin, SHORT_DEMO_TOPIC_MIN), questions };
    if (mustAsks?.length) block.mustAsks = mustAsks;
    else delete block.mustAsks;
    kept.push(block);
  }
  kept.push(...closing);
  // Re-id in agenda order ("b0", "b1", …) and carry the private notes across the rename.
  const privateNotes: Record<string, string> = {};
  const blocks = kept.map((b, i) => {
    const id = `b${i}`;
    if (kit.privateNotes[b.id]) privateNotes[id] = kit.privateNotes[b.id];
    return { ...b, id };
  });
  const durationMin = blocks.reduce((n, b) => n + b.budgetMin, 0);
  const closeReserveMin = blocks.filter((b) => b.kind === "role_qa" || b.kind === "close").reduce((n, b) => n + b.budgetMin, 0);
  return {
    ...kit,
    agenda: { version: 1, durationMin, hardCapMin: Math.round(durationMin * HARD_CAP_FACTOR), closeReserveMin, blocks },
    privateNotes,
    demoAgenda: SHORT_DEMO_AGENDA,
  };
}
