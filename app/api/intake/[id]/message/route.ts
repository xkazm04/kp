import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIntake, updateIntakeDialog } from "@/app/_lib/db/intakes";
import { INTAKE_ROUND_FACT_CHARS, recordIntakeEvent } from "@/app/_lib/db/intake-events";
import { IntakeTimeoutError, runIntakeExchange } from "@/app/_lib/intake-run";
import { intakeLang } from "@/app/_lib/intake-lang";
import { stripEndSentinel } from "../../reply-sentinel";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentUserId, SESSION_COOKIE, verifySession } from "@/app/_lib/auth/session";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { externalRunner } from "@/app/_lib/task-external-runners";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

const MAX_MESSAGE_CHARS = 4_000;

/** The kind of the late-bound runner that classifies a round and writes its row. The
 *  same string late-bound-boot.ts registers; intake-topics.test.ts pins the two together
 *  by source scan, because a typo here is a runtime throw rather than a tsc error. */
const INTAKE_ROUND_RUNNER = "intake_round";

/** The signed-in person, in the journey contract's actor vocabulary.
 *
 *  `null` is a FACT, not a blank: an open or operator-password deployment genuinely has
 *  no identified user (auth/operator-approver.ts draws the same distinction for sealed
 *  decision records), and the board renders "not identified" as its own mark rather than
 *  as an empty cell. Reads the session cookie directly — `session.ts` is already on this
 *  route's graph through `currentWorkspace`, so this costs no new module. */
async function intakeActor(): Promise<string | null> {
  try {
    const jar = await cookies();
    const userId = currentUserId(verifySession(jar.get(SESSION_COOKIE)?.value));
    return userId ? `human:${userId}` : null;
  } catch {
    /* best-effort: an unreadable cookie jar means we do not know who this was, which is
       a recordable fact — it must never cost the exchange its reply or its history. */
    return null;
  }
}

/**
 * The round's history row — Journey Analytics' one new write (db/intake-events.ts).
 *
 * OFF THE REQUEST PATH, and never allowed to fail the reply. `intake_events` is
 * append-only, so a round's topic has to be decided BEFORE its row exists — there is no
 * UPDATE to add one afterwards. The classification therefore runs inside the late-bound
 * runner, registered at boot in app/_lib/late-bound-boot.ts and looked up through the
 * import-free registry in task-external-runners.ts. Neither the classifier nor its store
 * reaches app/_lib/tasks.ts, the hub ~60 routes already pay for.
 *
 * If the runner is not registered — a boot-order fault, or a process that never ran
 * instrumentation — the round still gets its row, UNCLASSIFIED. A NULL topic is a
 * first-class state the board renders through the row's kind; losing the round is not.
 */
async function recordRoundHistory(input: {
  intakeId: string;
  workspaceId: string;
  question: string;
  answer: string;
  occurredAt: string;
  actor: string | null;
}): Promise<void> {
  try {
    await externalRunner(INTAKE_ROUND_RUNNER)({
      workspaceId: input.workspaceId,
      signal: new AbortController().signal,
      progress: () => {},
      params: {
        intakeId: input.intakeId,
        question: input.question,
        answer: input.answer,
        occurredAt: input.occurredAt,
        actor: input.actor,
      },
    });
  } catch (error) {
    console.error("[intake] round classification unavailable — recording the round unclassified:", error);
    try {
      recordIntakeEvent({
        intakeId: input.intakeId,
        workspaceId: input.workspaceId,
        kind: "intake_round",
        occurredAt: input.occurredAt,
        actor: input.actor,
        facts: {
          question: input.question.slice(0, INTAKE_ROUND_FACT_CHARS),
          answer: input.answer.slice(0, INTAKE_ROUND_FACT_CHARS),
        },
      });
    } catch (writeError) {
      // An operator WOULD act on this: it means the intake history is silently
      // incomplete. The comment is the declaration that the request survives it; the log
      // line is what makes the gap findable.
      console.error("[intake] round history write failed:", writeError);
    }
  }
}

// POST /api/intake/[id]/message — one dialog exchange: the requestor's message
// in, the agent's reply + re-extracted RoleBrief out (persisted atomically).
//
// THROTTLE (rate-limit-contract.test.ts): every accepted message is a real,
// potentially-paid LLM call. The route is operator-gated, but in open mode
// (no KP_OPERATOR_PASSWORD) the whole API is open, so it must self-limit like
// /api/analyze: per-IP, 30/10min — a coaching-paced human exchange (read a
// reflection, think, type) runs well under one message per 20s, while a
// scripted loop is pinned. Runs AFTER the cheap refusals (404/409/400) so a
// rejected call never consumes budget, and BEFORE the DB write + model call.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const intake = getIntake(id, ws);
    // Every refusal below carries a CODE (docs/architecture/api-contracts.md
    // §1.1). They were English prose with no code, and the composer collapsed all
    // of them plus the throttle into one "send failed" line: "the session is
    // closed" (re-open it), "type something first" and "slow down" are three
    // different next actions and the reader was told none of them, in any
    // language but English.
    if (!intake) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    if (intake.status !== "open") return jsonRefusal("INTAKE_CLOSED", 409);
    const body = (await request.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
    if (!message) return jsonRefusal("INTAKE_TEXT_REQUIRED", 400);

    // 30/10min holds a human coaching pace. KP_BENCH_MODE=1 raises the budget
    // for the app-master mass-test driver (scripts/app-master-bench) on a LOCAL
    // bench server only — 4 scenarios × 9 scripted turns tripped the human
    // budget and cost a stub sweep ~20 min of throttle waits. Deliberately
    // env-gated at the server, never a client escape hatch; pinned in
    // rate-limit-contract.test.ts (both budgets).
    const benchMode = process.env.KP_BENCH_MODE === "1";
    if (!rateLimit(`intake-message:${clientIpFrom(request.headers)}`, { limit: benchMode ? 600 : 30, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // The transcript passed to the engine is the history BEFORE this message —
    // the engine fences the new message separately (exactly-once, the devcase
    // chat rule), so it must not also appear in the rendered history.
    const exchange = await runIntakeExchange(
      {
        transcript: intake.transcript,
        brief: intake.brief,
        message,
        lang: intakeLang(intake.lang),
        attachments: intake.attachments,
        // App master: the completed scan grounds every turn. Its presence is what
        // selects the persona overlay and the app-master slot script, so a session
        // whose scan has not landed yet talks like a normal intake until it does.
        dossier: intake.dossier,
      },
      // The requestor's Cancel is a real cancel: a composer left for another tab
      // should not leave a Python process (and a paid completion) running for a
      // screen nobody is watching.
      request.signal
    );

    // Recertify R-2: the <<END>> sentinel is an engine/eval wire contract, not
    // copy — strip it at the route boundary so it never reaches the stored
    // transcript or the requestor's screen. Shared with /voice-turn, which
    // needs the same strip for a stronger reason (the transport SPEAKS the
    // reply verbatim) — reply-sentinel.ts.
    const reply = stripEndSentinel(exchange.reply);
    const now = new Date().toISOString();
    // The card set rides the AGENT TURN THAT MADE IT, not a session column: a
    // reload then re-offers exactly the set that was on the table, still
    // attached to the question it answers, and an older turn's cards stay in
    // the transcript as the record of what was offered (the client only makes
    // the newest one interactive).
    const transcript = [
      ...intake.transcript,
      { role: "candidate" as const, text: message, at: now },
      { role: "interviewer" as const, text: reply, at: now, ...(exchange.choices ? { choices: exchange.choices } : {}) },
    ];
    // The brief's evolving title becomes the session title (first write wins
    // via COALESCE only when non-empty — a later rename by the engine sticks).
    const briefTitle = typeof exchange.brief?.title === "string" ? exchange.brief.title : "";
    // COMPARE-AND-SWAP, not a blind write. `intake.updatedAt` was read BEFORE the
    // spawn above, which takes as long as a model call; a human brief edit or a
    // spoken turn landing inside that window is already on the row, and writing
    // `exchange.brief` over it would revert a value the requestor STATED. The
    // refusal is the honest outcome — the client re-reads the session rather than
    // painting its own stale copy back over it.
    const write = updateIntakeDialog(
      id,
      {
        transcript,
        brief: exchange.brief,
        shape: exchange.shape,
        ...(briefTitle ? { title: briefTitle } : {}),
        ...(exchange.done ? { status: "complete" as const } : {}),
        expectedUpdatedAt: intake.updatedAt,
      },
      ws
    );
    if (write === "missing") return jsonRefusal("INTAKE_NOT_FOUND", 404);
    if (write === "moved") return jsonRefusal("INTAKE_BRIEF_MOVED", 409);
    // ONLY once the transcript write was ACCEPTED. A `moved` CAS refusal means this
    // round's turns are not on the row at all, and a ledger entry for a round that never
    // landed is a false record — worse than a missing one. `now` is the same stamp both
    // turns carry, so `occurred_at` is the round's own clock rather than the writer's.
    // Detached: the requestor's reply does not wait on history (or on classification).
    //
    // The QUESTION half of the round is the agent's previous turn — `intake.transcript`
    // is the history BEFORE this message, so its last turn is what the requestor is
    // answering. The opener has none, and a round with an empty question is still a
    // round (the classifier reads both halves and places what it can).
    const previous = intake.transcript.at(-1);
    void recordRoundHistory({
      intakeId: id,
      workspaceId: ws,
      question: previous && previous.role === "interviewer" ? previous.text : "",
      answer: message,
      occurredAt: now,
      actor: await intakeActor(),
    });
    return NextResponse.json({
      reply,
      brief: exchange.brief,
      shape: exchange.shape,
      done: exchange.done,
      source: exchange.source,
      // Decision cards for this turn, when the engine judged one earned
      // (app/_lib/intake-choices.ts). Absent on most turns.
      ...(exchange.choices ? { choices: exchange.choices } : {}),
      // WHY it degraded, and (for the scripted keyless path) in WHICH language.
      // Both facts were produced by the engine and thrown away at this boundary:
      // the pane could only say "AI is offline", so an operator on a keyless
      // install and one whose provider had just fallen over read the same
      // sentence and took the same useless action. `fallbackLang` is the honest
      // half of a stand-in: the scripted script exists in four locales and a
      // session asking for a fifth is SERVED one of them, silently, until now.
      ...(exchange.fallbackReason ? { fallbackReason: exchange.fallbackReason } : {}),
      ...(exchange.fallbackLang ? { fallbackLang: exchange.fallbackLang } : {}),
    });
  } catch (error) {
    // An aborted request is not a fault: the client is gone, and logging it as a
    // store error would file a deliberate cancel as an incident.
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    // The turn overran its stated budget (INTAKE_DIALOG_TIMEOUT_MS). That is a
    // decision we made, not a store fault: name it so the composer can offer a
    // retry instead of the generic "could not process that message".
    if (error instanceof IntakeTimeoutError) return jsonRefusal("INTAKE_TURN_TIMEOUT", 504);
    return safeJsonError(error, "api:intake/message", "INTAKE_MESSAGE_FAILED");
  }
}
