// The Decisions tab's COMMIT WINDOW (decisions-review-ui/B, challenge-r04).
//
// A quick reject — the ledger's ✕ and the candidate modal's Reject — used to call
// act() on the click, and what that write does cannot be taken back: the reject is
// sealed into the decision chain, the candidate is emailed and the ATS hears
// `candidate.rejected` (app/_lib/pipeline-entry-action.ts). The batch reject and the
// screening wave are confirm-gated for exactly that reason; the single-row door, the
// most-clicked one, was not.
//
// Instead of a confirm (which decays into a click-through), the decision is ARMED:
// the row leaves at once, an undo strip names who and counts the seconds, and the
// write happens only when the stated window closes. Undo cancels a timer — nothing
// is ever retracted, because nothing was written.
//
// This module is pure (no React, no DOM, no timers). The lifecycle is
//   idle → pending → committing → idle
// with four rules:
//   - ONE window. Arming a second decision FLUSHES the first (commits it) and then
//     arms, so the strip always names the latest and there is one Undo.
//   - A double click cannot arm twice: a row already pending, committing or in
//     flight is ignored (checked against the current state, not a stale closure).
//   - Teardown (the page going away) COMMITS a pending decision. Leaving never
//     drops a decision the recruiter made.
//   - A commit that did not land brings the row back and names it (lastFailure).
//
// Every write goes through commitDecision() below — a keepalive POST, so a commit
// issued from `pagehide` survives the page — and never through useDecisionsQueue's
// act(). The server's compare-and-swap (`expectedStage`, the stage the row was
// rendered from) still holds: a decision committed late is refused with a coded 409
// rather than overwriting a row another actor moved in the meantime.
//
// Residual, stated rather than implied away: the decision lives in the tab until it
// commits. A browser CRASH (or a killed process) inside the window loses it — the
// candidate simply stays in the queue, undecided. The strip says "nothing has been
// sent yet" for exactly that reason.
import { foldDecideResponse, type DecideFailure, type DecideOutcome } from "./decisionsDecideOutcome";

/** The stated window. Inside the registry's working band (5–10 s). */
export const DECISION_UNDO_MS = 8000;

export type WindowAction = "accept" | "reject";

/** What the recruiter decided, captured at the click. */
export type WindowDecision = {
  entryId: string;
  action: WindowAction;
  /** The candidate's name, for the strip. */
  label: string;
  /** The stage the row was rendered from — the server's CAS snapshot. */
  expectedStage: string;
};

export type CommitCommand = { kind: "commit" } & WindowDecision;

export type WindowFailure = { entryId: string; label: string; failure: DecideFailure };

type Base = {
  /** Commits issued but not yet settled (a flushed predecessor). Their rows stay hidden. */
  inflight: readonly WindowDecision[];
  /** Commits that landed; hidden until the queue's next read no longer lists them. */
  landed: readonly string[];
  /** The last commit that did NOT land, for the strip. */
  lastFailure: WindowFailure | null;
};

export type WindowState =
  | (Base & { kind: "idle" })
  | (Base & WindowDecision & { kind: "pending"; armedAt: number; deadline: number })
  | (Base & WindowDecision & { kind: "committing" });

export type Step = { state: WindowState; commands: CommitCommand[] };

const decisionOf = (s: WindowDecision): WindowDecision => ({
  entryId: s.entryId,
  action: s.action,
  label: s.label,
  expectedStage: s.expectedStage,
});
const commitOf = (d: WindowDecision): CommitCommand => ({ kind: "commit", ...decisionOf(d) });
const baseOf = (s: WindowState): Base => ({ inflight: s.inflight, landed: s.landed, lastFailure: s.lastFailure });
const same = (state: WindowState): Step => ({ state, commands: [] });

export function initialWindow(): WindowState {
  return { kind: "idle", inflight: [], landed: [], lastFailure: null };
}

/** Rows the ledger must not render: the pending/committing one, those in flight, those landed. */
export function hiddenIds(state: WindowState): Set<string> {
  const ids = new Set<string>([...state.inflight.map((d) => d.entryId), ...state.landed]);
  if (state.kind !== "idle") ids.add(state.entryId);
  return ids;
}

/** The click. Flush-then-arm; a row already in the window is ignored. */
export function arm(state: WindowState, decision: WindowDecision, now: number): Step {
  if (hiddenIds(state).has(decision.entryId)) return same(state);
  const commands: CommitCommand[] = [];
  let inflight = state.inflight;
  if (state.kind === "pending") {
    commands.push(commitOf(state));
    inflight = [...inflight, decisionOf(state)];
  } else if (state.kind === "committing") {
    inflight = [...inflight, decisionOf(state)];
  }
  return {
    state: {
      kind: "pending",
      ...decisionOf(decision),
      armedAt: now,
      deadline: now + DECISION_UNDO_MS,
      inflight,
      landed: state.landed,
      lastFailure: null,
    },
    commands,
  };
}

/** Undo inside the window: nothing was written, nothing will be. */
export function undo(state: WindowState): Step {
  if (state.kind !== "pending") return same(state);
  return same({ kind: "idle", ...baseOf(state) });
}

/** The timer. Commits only once the deadline is reached. */
export function expire(state: WindowState, now: number): Step {
  if (state.kind !== "pending" || now < state.deadline) return same(state);
  return { state: { kind: "committing", ...decisionOf(state), ...baseOf(state) }, commands: [commitOf(state)] };
}

/** The page is going away: a pending decision is committed NOW, never dropped. */
export function teardown(state: WindowState): Step {
  if (state.kind !== "pending") return same(state);
  return { state: { kind: "committing", ...decisionOf(state), ...baseOf(state) }, commands: [commitOf(state)] };
}

export type SettleResult = { entryId: string; ok: true } | { entryId: string; ok: false; failure: DecideFailure };

/** A commit answered. A landed row stays hidden; a refused one comes back, named. */
export function settled(state: WindowState, result: SettleResult): Step {
  const isCurrent = state.kind === "committing" && state.entryId === result.entryId;
  const flushed = state.inflight.find((d) => d.entryId === result.entryId);
  if (!isCurrent && !flushed) return same(state);
  const label = isCurrent && state.kind === "committing" ? state.label : (flushed?.label ?? "");
  const inflight = state.inflight.filter((d) => d.entryId !== result.entryId);
  const landed = result.ok ? [...state.landed, result.entryId] : state.landed;
  const lastFailure = result.ok ? (isCurrent ? null : state.lastFailure) : { entryId: result.entryId, label, failure: result.failure };
  if (isCurrent) return same({ kind: "idle", inflight, landed, lastFailure });
  return same({ ...state, inflight, landed, lastFailure });
}

/** The strip's failure line was read and closed. */
export function dismissFailure(state: WindowState): Step {
  return state.lastFailure ? same({ ...state, lastFailure: null }) : same(state);
}

/** The queue re-read: a landed row it no longer lists needs no overlay any more. */
export function prune(state: WindowState, presentIds: ReadonlySet<string>): Step {
  const landed = state.landed.filter((id) => presentIds.has(id));
  return landed.length === state.landed.length ? same(state) : same({ ...state, landed });
}

/**
 * The ONE write the window issues — for an expired window and for a page that is
 * going away alike. `keepalive: true` lets the request outlive the document, which a
 * plain fetch (act()'s) does not: the browser cancels it on navigation or close, and
 * a deferred reject would be DROPPED. The body is the same one act() sends, CAS
 * included. Never throws: a dropped request folds to a code-less failure.
 */
export async function commitDecision(
  entryId: string,
  action: WindowAction,
  expectedStage: string,
  fetchImpl: typeof fetch = fetch
): Promise<DecideOutcome> {
  // Only the action matters to the fold's handoff rule for a reject; an accept's
  // handoff (Schedule, prep, offer link) belongs to act(), which the window never defers.
  const kind = { approvalKind: null };
  try {
    const r = await fetchImpl(`/api/pipeline/${encodeURIComponent(entryId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, expectedStage }),
      keepalive: true,
    });
    const body = await r.json().catch(() => null);
    return foldDecideResponse(kind, action, { ok: r.ok, status: r.status }, body);
  } catch {
    // Folded, not thrown: offline / aborted — the strip names it and the row returns.
    return foldDecideResponse(kind, action, null, null);
  }
}
