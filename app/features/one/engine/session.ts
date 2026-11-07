// /one's session state as a PURE reducer (useOneSession.ts is the React wrapper).
//
// The rules it holds, from reversible-screen-ops and composition-region:
//   - the region holds ≤ MAX_PANELS views; a fourth `show` replaces the OLDEST UNPINNED
//     one (pins ≤ MAX_PINS, so there is always one to replace) and says which;
//   - showing a view that is already on screen (same kind + params) FOCUSES it instead
//     of drawing a duplicate — values update in place, the region does not re-form;
//   - every screen change is a step: the prior arrangement is captured BEFORE the
//     change (record-precedes-effect), a one-line `lastChange` says what changed, and
//     `undo` restores exactly the arrangement before the last step. Undo is the host's
//     control, never a verb a reply can emit; it covers screen changes, not data acts;
//   - a reply's ops are PENDING for a beat before they apply; the user's own hand on the
//     region (pin, close, focus) supersedes them — the stale ops are dropped and the
//     drop is said, never applied over the user's click;
//   - `stop` drops anything pending and restores the arrangement the user saw before
//     the turn began.
import {
  MAX_PANELS,
  MAX_PINS,
  type ChangeLine,
  type OneInput,
  type Op,
  type PanelInstance,
  type ProposalInstance,
  type Reply,
  type Turn,
} from "../types";

export type Arrangement = { panels: PanelInstance[]; focusId: string | null };

export type SessionState = {
  turns: Turn[];
  panels: PanelInstance[];
  focusId: string | null;
  proposals: ProposalInstance[];
  /** Undo stack of arrangements, newest last. */
  history: Arrangement[];
  lastChange: ChangeLine | null;
  /** A reply's ops not yet applied, and the arrangement before its turn began. */
  pending: { turnId: string; ops: Op[]; before: Arrangement } | null;
  /** Monotonic id source — ids are the host's, never the model's. */
  seq: number;
};

export const initialSession = (): SessionState => ({
  turns: [],
  panels: [],
  focusId: null,
  proposals: [],
  history: [],
  lastChange: null,
  pending: null,
  seq: 0,
});

export type SessionAction =
  | { type: "submit"; input: OneInput; reply: Reply; dropped: number }
  | { type: "applyPending" }
  | { type: "stop" }
  | { type: "show"; kind: PanelInstance["kind"]; params?: Record<string, string> }
  | { type: "focus"; panelId: string }
  | { type: "close"; panelId: string }
  | { type: "pin"; panelId: string }
  | { type: "unpin"; panelId: string }
  | { type: "undo" }
  | { type: "propose"; act: ProposalInstance["act"]; params: Record<string, string> }
  | { type: "dismissProposal"; proposalId: string };

const HISTORY_CAP = 20;

const snapshot = (s: SessionState): Arrangement => ({ panels: s.panels.map((p) => ({ ...p, params: { ...p.params } })), focusId: s.focusId });

const sameParams = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

/** Record the prior arrangement, then apply `next` — the order the standard requires. */
function step(s: SessionState, next: Partial<SessionState>, change: ChangeLine): SessionState {
  return { ...s, history: [...s.history, snapshot(s)].slice(-HISTORY_CAP), ...next, lastChange: change };
}

/** The user's hand on the region: drop pending ops first, and say so. */
function byHand(s: SessionState): { s: SessionState; dropped: boolean } {
  if (!s.pending) return { s, dropped: false };
  return { s: { ...s, pending: null }, dropped: true };
}

/** After a hand action that superseded pending ops: the line keeps what the HAND did and
 *  adds that the conductor's change was dropped; a hand action that changed nothing
 *  still reports the drop. */
function markDropped(base: SessionState, next: SessionState, dropped: boolean): SessionState {
  if (!dropped) return next;
  if (next === base || !next.lastChange) return { ...next, lastChange: { key: "dropped" } };
  return { ...next, lastChange: { ...next.lastChange, droppedPending: true } };
}

function applyShow(s: SessionState, kind: PanelInstance["kind"], params: Record<string, string>): SessionState {
  const existing = s.panels.find((p) => p.kind === kind && sameParams(p.params, params));
  if (existing) {
    if (s.focusId === existing.id) return s; // already there and forward: nothing changed, no step
    return step(s, { focusId: existing.id }, { key: "focused", panel: kind });
  }
  const seq = s.seq + 1;
  const fresh: PanelInstance = { id: `p${seq}`, kind, params: { ...params }, pinned: false };
  if (s.panels.length < MAX_PANELS) {
    return step(s, { panels: [...s.panels, fresh], focusId: fresh.id, seq }, { key: "shown", panel: kind });
  }
  // Replace the oldest unpinned in place: its slot keeps its position in reading order.
  const victimIndex = s.panels.findIndex((p) => !p.pinned);
  if (victimIndex < 0) return s; // unreachable while MAX_PINS < MAX_PANELS
  const victim = s.panels[victimIndex];
  const panels = s.panels.map((p, i) => (i === victimIndex ? fresh : p));
  return step(s, { panels, focusId: fresh.id, seq }, { key: "replaced", panel: kind, previous: victim.kind });
}

function applyOp(s: SessionState, op: Op): SessionState {
  switch (op.op) {
    case "show":
      return applyShow(s, op.panel, op.params ?? {});
    case "focus": {
      const p = s.panels.find((x) => x.id === op.panelId);
      if (!p || s.focusId === p.id) return s;
      return step(s, { focusId: p.id }, { key: "focused", panel: p.kind });
    }
    case "propose":
    case "navigate":
      // Never pending: a proposal lands with its turn and a navigate is offered as a
      // link on the turn (see `submit`); neither moves the region.
      return s;
  }
}

export function sessionReducer(s: SessionState, a: SessionAction): SessionState {
  switch (a.type) {
    case "submit": {
      // A new turn supersedes a pending one: its ops are dropped, not stacked.
      const base = s.pending ? { ...s, pending: null } : s;
      const seq = base.seq + 2;
      const userTurn: Turn = { id: `t${seq - 1}`, who: "user", text: a.input.chip ? null : (a.input.text ?? "").trim() || null, chip: a.input.chip ?? null };
      const links = a.reply.ops.flatMap((op) => (op.op === "navigate" ? [{ tab: op.tab, params: { ...(op.params ?? {}) } }] : []));
      const oneTurn: Turn = {
        id: `t${seq}`,
        who: "one",
        say: a.reply.say,
        chips: [...a.reply.chips],
        fallback: Boolean(a.reply.fallback),
        links,
        dropped: a.dropped,
      };
      // Proposals land WITH the turn: an offer is not a rearrangement of the region, so
      // the user's hand on a panel never cancels it (only their own dismiss does).
      let nextSeq = seq;
      const proposals: ProposalInstance[] = a.reply.ops.flatMap((op) =>
        op.op === "propose" ? [{ id: `a${++nextSeq}`, act: op.act, params: { ...op.params }, origin: "reply" as const, turnId: oneTurn.id }] : []
      );
      // Screen ops wait a beat (useOneSession applies them) so a hand can supersede them.
      const ops = a.reply.ops.filter((op) => op.op === "show" || op.op === "focus");
      return {
        ...base,
        seq: nextSeq,
        turns: [...base.turns, userTurn, oneTurn],
        proposals: [...base.proposals, ...proposals],
        pending: ops.length > 0 ? { turnId: oneTurn.id, ops, before: snapshot(base) } : null,
      };
    }
    case "applyPending": {
      if (!s.pending) return s;
      let next: SessionState = { ...s, pending: null };
      for (const op of s.pending.ops) next = applyOp(next, op);
      return next;
    }
    case "stop": {
      const before = s.pending?.before;
      if (!before) return { ...s, pending: null, lastChange: { key: "stopped" } };
      return { ...s, pending: null, panels: before.panels, focusId: before.focusId, lastChange: { key: "stopped" } };
    }
    case "show": {
      const { s: base, dropped } = byHand(s);
      return markDropped(base, applyShow(base, a.kind, a.params ?? {}), dropped);
    }
    case "focus": {
      const { s: base, dropped } = byHand(s);
      const p = base.panels.find((x) => x.id === a.panelId);
      if (!p || base.focusId === p.id) return markDropped(base, base, dropped);
      return markDropped(base, step(base, { focusId: p.id }, { key: "focused", panel: p.kind }), dropped);
    }
    case "close": {
      const { s: base, dropped } = byHand(s);
      const p = base.panels.find((x) => x.id === a.panelId);
      if (!p) return markDropped(base, base, dropped);
      const panels = base.panels.filter((x) => x.id !== a.panelId);
      const focusId = base.focusId === p.id ? (panels.at(-1)?.id ?? null) : base.focusId;
      return markDropped(base, step(base, { panels, focusId }, { key: "closed", panel: p.kind }), dropped);
    }
    case "pin":
    case "unpin": {
      const { s: base, dropped } = byHand(s);
      const p = base.panels.find((x) => x.id === a.panelId);
      if (!p) return markDropped(base, base, dropped);
      const pin = a.type === "pin";
      if (p.pinned === pin) return markDropped(base, base, dropped);
      if (pin && base.panels.filter((x) => x.pinned).length >= MAX_PINS) {
        return markDropped(base, { ...base, lastChange: { key: "pinLimit", panel: p.kind } }, dropped);
      }
      const panels = base.panels.map((x) => (x.id === p.id ? { ...x, pinned: pin } : x));
      return markDropped(base, step(base, { panels }, { key: pin ? "pinned" : "unpinned", panel: p.kind }), dropped);
    }
    case "undo": {
      const prev = s.history.at(-1);
      if (!prev) return s;
      return { ...s, pending: null, panels: prev.panels, focusId: prev.focusId, history: s.history.slice(0, -1), lastChange: { key: "undone" } };
    }
    case "propose": {
      const seq = s.seq + 1;
      return { ...s, seq, proposals: [...s.proposals, { id: `a${seq}`, act: a.act, params: { ...a.params }, origin: "hand", turnId: null }] };
    }
    case "dismissProposal":
      return { ...s, proposals: s.proposals.filter((p) => p.id !== a.proposalId) };
  }
}
