// The transcript of RECORD for a completed interview: the director's ledger, not
// the hang-up POST (challenge-r07 voice-interview-api/A).
//
// A directed voice interview has two records of what was said:
//   1. the director's append-only ledger — interview_events `turn` rows, received
//      live on every /director exchange, idempotent per (session, attempt, seq),
//      and already clamped at that door (director-step.ts);
//   2. the array the candidate's browser POSTs to /api/interview/complete.
// /complete used to persist and score only the second. That array is
// client-authored, and it is not even the whole interview for an honest client: a
// reconnect seeds the browser with only the LAST RESUME_PRIOR_TURNS earlier-attempt
// turns (resume.ts), so a resumed call whose first attempt ran past that lost its
// OPENING — the role framing and the candidate's own account of their background —
// from the stored transcript and from the scorecard, silently. The opening is not
// disposable (interview-transcript.ts keeps head AND tail for the same reason).
//
// The rule, in one place:
//   - No ledger turns (the lab, /simulate demos, an ElevenLabs agent without client
//     tools, the spoken eval harness that never posts /director) -> the body passes
//     through UNCHANGED, byte for byte.
//   - An empty body passes through too: "the call reported nothing" is governed by
//     the route's own guards (an empty finalize never replaces a stored transcript
//     and never completes a call), not turned into a completion by this merge.
//   - Otherwise every ledger turn, in (attempt, seq) order, is authoritative. The
//     body is anchored on its LAST occurrence of the ledger's final turn (role + the
//     clamped text) and contributes only what follows it — turns finalized after the
//     last acknowledged director exchange — plus its own `system` marker turns. A
//     ledger the director stopped appending to (MAX_INTERVIEW_EVENTS_PER_SESSION)
//     still anchors on its last STORED turn, so everything after it rides the tail.
//   - A body turn that neither matches the ledger (in order) nor sits in that tail is
//     dropped and COUNTED as `unanchored`: a hang-up POST cannot rewrite or insert a
//     turn the server already received.
//   - Anchor miss -> every ledger turn + the body's `system` turns. Degrade, never
//     refuse: the ledger alone is still the interview.
//
// Pure: no DB, no request. The route reads the ledger and clamps/caps the result.

import { clampTurn } from "../interview-transcript";

/** The structural shape of a ledger row this merge reads (db/interview-events.ts
 *  InterviewEvent satisfies it). */
export type LedgerTurnEvent = {
  kind: string;
  attempt: number;
  seq: number | null;
  payload: Record<string, unknown>;
  at: string;
};

/** One ledger turn, normalized. */
export type LedgerTurn = {
  attempt: number;
  seq: number;
  role: "candidate" | "interviewer" | "system";
  text: string;
  at?: string;
};

/** A body turn as the route filtered it: untrusted, not yet clamped. */
export type SubmittedTurn = { role?: unknown; text: string; at?: unknown };

export type TranscriptOfRecord = {
  /** The transcript to persist, score and duplicate-check (still to be clamped and
   *  capped by the caller, exactly like a body). */
  turns: SubmittedTurn[];
  /** Body turns dropped because they matched no ledger turn and were not in the
   *  unacknowledged tail (0 on passthrough). A count only — never log the text. */
  unanchored: number;
  /** "passthrough" (no ledger / empty body), "anchored", or "anchor_miss". */
  mode: "passthrough" | "anchored" | "anchor_miss";
};

/** Normalize a session's `turn` events into ledger turns in (attempt, seq) order. */
export function ledgerTurnsFromEvents(events: readonly LedgerTurnEvent[]): LedgerTurn[] {
  return events
    .filter((e) => e.kind === "turn" && e.seq !== null && typeof e.payload.text === "string")
    .map((e) => ({
      attempt: e.attempt,
      seq: e.seq as number,
      role:
        e.payload.role === "candidate" || e.payload.role === "interviewer"
          ? (e.payload.role as "candidate" | "interviewer")
          : ("system" as const),
      text: e.payload.text as string,
      at: e.at,
    }))
    .sort((a, b) => a.attempt - b.attempt || a.seq - b.seq);
}

/** Role + clamped text: the same comparison both doors' clampTurn makes true. */
function key(role: unknown, text: string): string {
  const { turn } = clampTurn({ role, text });
  return `${turn.role}\u0000${turn.text}`;
}

function fromLedger(t: LedgerTurn): SubmittedTurn {
  return t.at === undefined ? { role: t.role, text: t.text } : { role: t.role, text: t.text, at: t.at };
}

export function transcriptOfRecord(input: {
  ledgerTurns: readonly LedgerTurn[];
  submitted: readonly SubmittedTurn[];
}): TranscriptOfRecord {
  const { submitted } = input;
  if (input.ledgerTurns.length === 0 || submitted.length === 0) {
    return { turns: [...submitted], unanchored: 0, mode: "passthrough" };
  }
  const ledger = [...input.ledgerTurns].sort((a, b) => a.attempt - b.attempt || a.seq - b.seq);
  const ledgerKeys = ledger.map((t) => key(t.role, t.text));
  const lastKey = ledgerKeys[ledgerKeys.length - 1];

  // The anchor: the body's LAST occurrence of the ledger's final turn.
  let anchor = -1;
  for (let i = submitted.length - 1; i >= 0; i -= 1) {
    if (key(submitted[i].role, submitted[i].text) === lastKey) {
      anchor = i;
      break;
    }
  }
  const head = anchor >= 0 ? submitted.slice(0, anchor + 1) : submitted;
  const tail = anchor >= 0 ? submitted.slice(anchor + 1) : [];

  // Align the head against the ledger in order. A matched turn is already in the
  // record; an unmatched `system` marker is kept where it stood (after the last
  // matched ledger turn, or at the top on an anchor miss's end); anything else is
  // an unanchored turn — rewritten or inserted — and is dropped.
  const insertsAfter = new Map<number, SubmittedTurn[]>();
  const trailingMarkers: SubmittedTurn[] = [];
  let pointer = 0; // next ledger index a body turn may match
  let unanchored = 0;
  for (const t of head) {
    const k = key(t.role, t.text);
    let found = -1;
    for (let j = pointer; j < ledgerKeys.length; j += 1) {
      if (ledgerKeys[j] === k) {
        found = j;
        break;
      }
    }
    if (found >= 0) {
      pointer = found + 1;
      continue;
    }
    if (clampTurn({ role: t.role, text: t.text }).turn.role === "system") {
      if (anchor >= 0) {
        const at = pointer - 1;
        insertsAfter.set(at, [...(insertsAfter.get(at) ?? []), t]);
      } else {
        trailingMarkers.push(t);
      }
      continue;
    }
    unanchored += 1;
  }

  const turns: SubmittedTurn[] = [...(insertsAfter.get(-1) ?? [])];
  ledger.forEach((t, i) => {
    turns.push(fromLedger(t));
    const extra = insertsAfter.get(i);
    if (extra) turns.push(...extra);
  });
  turns.push(...tail, ...trailingMarkers);
  return { turns, unanchored, mode: anchor >= 0 ? "anchored" : "anchor_miss" };
}
