// A tiny SimConversationDump builder for the verdict tests (spark interview-uat-tranche,
// WP-2). TEST-ONLY: nothing in the app imports it. It writes a conversation step by step
// and produces the two parallel records the engine would — the transcript AND the
// director's events — with the same joins record.ts relies on (the k-th tool turn is
// callId `sim-k`; the k-th director turn is `trace.directives[k]`; every candidate turn is
// posted as a `turn` event tagged with the block active when it was recorded).

import type { DirectorEvent } from "../voice/director";
import type { AgendaBlock, DirectiveKind, InterviewAgenda } from "../voice/director-types";
import { SIM_EPOCH_MS } from "./clock";
import type { SimConversationDump, SimTrace } from "./engine";
import type { SimEndReason, SimSituation, SimTurn } from "./types";

export type BuildStep =
  | { iv: string; at?: number }
  | { cand: string; at?: number }
  | { note: DirectiveKind; block?: string | null; at?: number }
  | { harness: string; at?: number }
  | {
      tool: string;
      args?: Record<string, unknown> | string;
      /** Rejections and refusals, where the director would give them. */
      reject?: "no_match" | "too_short" | "empty" | "too_long";
      refused?: boolean;
      /** A tool line that did not parse. */
      unparsed?: boolean;
      at?: number;
    };

export const TEST_AGENDA: InterviewAgenda = {
  version: 1,
  durationMin: 20,
  hardCapMin: 24,
  closeReserveMin: 4,
  blocks: [
    { id: "b0", kind: "warmup", title: "Warm-up", budgetMin: 1, competency: null, scored: false, questions: ["Where are you joining from?"] },
    { id: "b1", kind: "topic", title: "Service ownership", budgetMin: 6, competency: "own", scored: true, questions: ["Walk me through a service you owned."], mustAsks: [{ id: "q1", text: "Walk me through a service you owned." }] },
    { id: "b2", kind: "topic", title: "Working with others", budgetMin: 4, competency: "collab", scored: true, questions: ["Tell me about a disagreement."] },
    { id: "b3", kind: "role_qa", title: "Your questions", budgetMin: 2, competency: null, scored: false, questions: [] },
    { id: "b4", kind: "close", title: "Wrap-up", budgetMin: 2, competency: null, scored: false, questions: [] },
  ] satisfies AgendaBlock[],
};

export function testSituation(over: Partial<SimSituation> = {}): SimSituation {
  return {
    id: "kit-test-en",
    title: "test",
    behaviour: "strong",
    language: "en",
    fixture: "kit",
    persona: "test persona",
    provokes: ["completed"],
    handles: "A test situation.",
    ...over,
  };
}

export type BuildOptions = {
  endedBy?: SimEndReason;
  runId?: string;
  situationId?: string;
  locale?: string | null;
  agenda?: InterviewAgenda;
  final?: Partial<SimTrace["final"]>;
  endSignal?: SimTrace["endSignal"];
  error?: string;
};

/** Build a dump from steps. Each step advances the simulated clock by 10 s unless `at` (ms) is given. */
export function buildDump(steps: readonly BuildStep[], opts: BuildOptions = {}): SimConversationDump {
  const agenda = opts.agenda ?? TEST_AGENDA;
  const turns: SimTurn[] = [];
  const events: DirectorEvent[] = [];
  const directives: SimTrace["directives"] = [];
  let seq = 0;
  let clock = 0;
  let call = 0;
  let turnSeq = 0;
  let active: string | null = null;
  const covered = new Set<string>();
  const begun = new Set<string>();
  let endSignal: SimTrace["endSignal"] = null;
  let overrunAnswer: string | null = null;
  const iso = (ms: number) => new Date(SIM_EPOCH_MS + ms).toISOString();
  const ev = (kind: DirectorEvent["kind"], blockId: string | null, payload: Record<string, unknown>, at: number, s: number | null = null) =>
    events.push({ kind, attempt: 1, seq: s, blockId, payload, createdAt: iso(at) });

  for (const step of steps) {
    clock = step.at ?? clock + 10_000;
    if ("iv" in step) {
      turns.push({ seq: seq++, role: "interviewer", text: step.iv, simAtMs: clock });
      ev("turn", active, { role: "interviewer", text: step.iv }, clock, turnSeq++);
    } else if ("cand" in step) {
      turns.push({ seq: seq++, role: "candidate", text: step.cand, simAtMs: clock });
      ev("turn", active, { role: "candidate", text: step.cand }, clock, turnSeq++);
    } else if ("note" in step) {
      const text = `[Director] ${step.note} ${step.block ?? ""}`.trim();
      turns.push({ seq: seq++, role: "director", text, simAtMs: clock });
      directives.push({ simAtMs: clock, id: `dir-${seq}`, kind: step.note, blockId: step.block ?? null });
      ev("directive", step.block ?? null, { directiveId: `dir-${seq}`, kind: step.note, text }, clock);
    } else if ("harness" in step) {
      turns.push({ seq: seq++, role: "system", text: step.harness, simAtMs: clock });
    } else {
      call += 1;
      const callId = `sim-${call}`;
      const args = step.args ?? {};
      const a = typeof args === "string" ? {} : args;
      const name = step.unparsed ? "(unparsed)" : step.tool;
      const blockId = typeof a.block_id === "string" ? a.block_id : null;
      let result = "Continue with the agenda.";
      const rec = (kind: DirectorEvent["kind"], b: string | null, payload: Record<string, unknown>, r: string) => {
        result = r;
        ev(kind, b, { ...payload, callId, toolResult: r }, clock);
      };
      if (!step.unparsed) {
        switch (step.tool) {
          case "begin_topic":
            if (blockId && agenda.blocks.some((b) => b.id === blockId) && !covered.has(blockId) && active !== blockId) {
              rec("topic_begun", blockId, {}, `Recorded. Continue with block ${blockId}.`);
              begun.add(blockId);
              active = blockId;
            }
            break;
          case "mark_topic_covered":
            if (blockId) {
              if (step.reject) rec("topic_cover_rejected", blockId, { quote: a.evidence_quote, reason: step.reject }, "Not recorded: ask one narrower question.");
              else {
                rec("topic_covered", blockId, { quote: a.evidence_quote }, "Recorded. Close this topic and continue with the next agenda block.");
                covered.add(blockId);
                if (active === blockId) active = null;
              }
            }
            break;
          case "report_guardrail":
            rec("guardrail", active, { kind: a.kind, quote: a.quote, verified: true }, "Recorded. Decline in one polite sentence and continue with the agenda.");
            break;
          case "forward_question":
            rec("candidate_question", active, { question: a.question }, "Recorded. Tell the candidate the recruiter will follow up, then continue with the agenda.");
            break;
          case "report_extra_time":
            rec("overrun_answered", active, { answer: a.answer }, "Recorded.");
            overrunAnswer ??= String(a.answer);
            break;
          case "end_interview":
            if (step.refused) {
              const next = agenda.blocks.find((b) => (b.kind === "topic" || b.kind === "open") && !covered.has(b.id));
              rec("end_requested", active, { reason: a.reason, refused: true }, `Not yet — 1 topic remains. Continue with ${next?.id ?? "b1"} · ${next?.title ?? ""}.`);
            } else {
              rec("end_requested", active, { reason: a.reason }, "Recorded. Say your short closing line now; the call ends after it.");
              endSignal ??= { source: "end_interview", simAtMs: clock };
            }
            break;
          default:
            break;
        }
      }
      turns.push({ seq: seq++, role: "system", text: `<<tool ${JSON.stringify({ name: step.tool, args })}>>`, simAtMs: clock, tool: { name, args, result } });
    }
  }

  const endedBy = opts.endedBy ?? (endSignal ? "end_interview" : "max_turns");
  return {
    runId: opts.runId ?? "run-test",
    situationId: opts.situationId ?? "kit-test-en",
    fixture: "kit",
    instrument: { briefSha: "sha256:test", agendaBlockIds: agenda.blocks.map((b) => b.id), directorVersion: "sha256:dir" },
    turns,
    endedBy,
    simElapsedMs: clock,
    calls: call,
    ...(opts.error ? { error: opts.error } : {}),
    trace: {
      engine: "interview-sim/1",
      instrumentKey: "kit.en",
      locale: opts.locale === undefined ? "en" : opts.locale,
      bookedMin: agenda.durationMin,
      providers: { interviewer: "fake-interviewer", candidate: "fake-candidate" },
      clock: { wpm: 150, turnLatencyMs: 1500, heartbeatMs: 20_000, epochIso: new Date(SIM_EPOCH_MS).toISOString() },
      limits: { maxCalls: 120, maxCandidateTurns: 50 },
      events,
      directives,
      final: {
        activeBlockId: active,
        coveredBlockIds: agenda.blocks.map((b) => b.id).filter((id) => covered.has(id)),
        begunBlockIds: agenda.blocks.map((b) => b.id).filter((id) => begun.has(id)),
        elapsedMs: clock,
        endLimitMs: (agenda.hardCapMin + 2) * 60_000,
        overrunRequested: directives.some((d) => d.kind === "ask_overrun"),
        overrunAnswer: (overrunAnswer as "agreed" | "declined" | null) ?? null,
        outstandingMustAsks: agenda.blocks.filter((b) => !covered.has(b.id)).flatMap((b) => (b.mustAsks ?? []).map((m) => ({ blockId: b.id, id: m.id, text: m.text }))),
        ...opts.final,
      },
      endSignal: opts.endSignal !== undefined ? opts.endSignal : endSignal,
      hardStopAtSimMs: null,
    },
  };
}
