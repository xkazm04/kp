// The ONE validation door every reply passes before anything reaches the screen
// (reversible-screen-ops: "every reply's operations pass through one validation door").
//
// resolve.ts is deterministic and already emits a clean vocabulary, so for round 1 this
// door mostly proves a negative. It exists now so a model-backed composer can be swapped
// in behind `resolve`'s signature without the screen trusting it:
//   - an unknown verb, panel, act, chip or say key is not applied and not silently
//     skipped: it is DROPPED and COUNTED, and the count is disclosed on the turn;
//   - a known verb with bad arguments is dropped;
//   - a `propose` whose params name any field its act does not declare is dropped WHOLE,
//     never trimmed into shape — the one part of a reply that can change data is the
//     part that must never be rebuilt from damage;
//   - an entry act bound to an id the user was never shown is dropped (an invented id
//     is the binding-shaped version of an invented number);
//   - a `say` value carrying a digit is refused and the say falls back to `notYet`
//     WITHOUT values: the model's words may not hold figures, panels own the numbers;
//   - ≤ MAX_OPS ops and ≤ MAX_CHIPS chips: a reply that wants fifteen changes is a
//     rearrangement, whatever its verbs are called.
import { isWorkspaceTabId } from "@/app/features/shell/tabs";
import { ACT_PARAMS } from "../consent/actParams";
import {
  isActKind,
  isChipId,
  isPanelKind,
  isSayKey,
  MAX_CHIPS,
  MAX_OPS,
  type ChipId,
  type Op,
  type Reply,
  type Say,
} from "../types";

export type ValidateContext = {
  /** Entry ids present in data the user has on screen. Entry acts outside it drop. */
  knownEntryIds?: ReadonlySet<string>;
  /** Panel ids currently on screen; a `focus` on anything else drops. */
  panelIds?: ReadonlySet<string>;
};

export type Validated = { reply: Reply; dropped: number };

const isStringRecord = (v: unknown): v is Record<string, string> =>
  v != null && typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => typeof x === "string");

const MAX_PARAM_CHARS = 120;

/** Acts bound to one candidate: an id the user was never shown drops the act. */
const ENTRY_ACTS: ReadonlySet<string> = new Set(["entryAdvance", "entryReject", "letterApprove", "letterSend", "interviewBook", "interviewLink"]);
const paramsOk = (p: Record<string, string>) => Object.values(p).every((v) => v.length <= MAX_PARAM_CHARS);

function validOp(raw: unknown, ctx: ValidateContext): Op | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  switch (o.op) {
    case "show": {
      if (!isPanelKind(o.panel)) return null;
      if (o.params !== undefined && !(isStringRecord(o.params) && paramsOk(o.params))) return null;
      return { op: "show", panel: o.panel, ...(o.params ? { params: { ...(o.params as Record<string, string>) } } : {}) };
    }
    case "focus": {
      if (typeof o.panelId !== "string") return null;
      if (ctx.panelIds && !ctx.panelIds.has(o.panelId)) return null;
      return { op: "focus", panelId: o.panelId };
    }
    case "propose": {
      if (!isActKind(o.act) || !isStringRecord(o.params) || !paramsOk(o.params)) return null;
      const spec = ACT_PARAMS[o.act];
      const keys = Object.keys(o.params);
      if (keys.some((k) => !spec.allowed.includes(k))) return null; // a stray field drops the whole act
      if (spec.required.some((k) => !o.params || !(o.params as Record<string, string>)[k])) return null;
      if (ENTRY_ACTS.has(o.act) && !ctx.knownEntryIds?.has((o.params as Record<string, string>).entryId)) return null;
      return { op: "propose", act: o.act, params: { ...(o.params as Record<string, string>) } };
    }
    case "navigate": {
      if (typeof o.tab !== "string" || !isWorkspaceTabId(o.tab)) return null;
      if (o.params !== undefined && !(isStringRecord(o.params) && paramsOk(o.params))) return null;
      return { op: "navigate", tab: o.tab, ...(o.params ? { params: { ...(o.params as Record<string, string>) } } : {}) };
    }
    default:
      return null;
  }
}

function validSay(raw: unknown): Say | null {
  if (raw == null || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (!isSayKey(s.key)) return null;
  if (s.values === undefined) return { key: s.key };
  if (!isStringRecord(s.values)) return null;
  if (Object.values(s.values).some((v) => /\d/.test(v))) return null; // a figure in the model's words
  return { key: s.key, values: { ...s.values } };
}

export function validateReply(raw: unknown, ctx: ValidateContext = {}): Validated {
  let dropped = 0;
  const r = (raw ?? {}) as Record<string, unknown>;
  const say = validSay(r.say);
  const rawOps = Array.isArray(r.ops) ? r.ops : [];
  const ops: Op[] = [];
  for (const o of rawOps) {
    const ok = ops.length < MAX_OPS ? validOp(o, ctx) : null;
    if (ok) ops.push(ok);
    else dropped++;
  }
  const chips: ChipId[] = [];
  for (const c of Array.isArray(r.chips) ? r.chips : []) {
    if (isChipId(c) && !chips.includes(c) && chips.length < MAX_CHIPS) chips.push(c);
  }
  if (!say) {
    // The words failed the door: keep whatever valid ops there were (the screen change
    // is still explained by its own "what changed" line) and say the honest fallback.
    return { reply: { say: { key: "notYet" }, ops, chips, fallback: true }, dropped: dropped + 1 };
  }
  return { reply: { say, ops, chips, ...(r.fallback === true ? { fallback: true } : {}) }, dropped };
}
