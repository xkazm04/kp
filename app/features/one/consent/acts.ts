// Resolve a proposed act into what the ConsentCard draws and what its press sends —
// PURE, from the act's typed params only, never from the conductor's words.
//
// The consent surface renders from THIS value (who, what, the consequence including
// "emails the candidate" where the door does, any cost, and whether an undo exists), so
// a reply that described the act wrongly cannot change what the user agrees to.
//
// Doors (no new ones — docs/design/one-interface.md "Acts and their doors"):
//   entryAdvance / entryReject → POST /api/pipeline/[id] {action, expectedStage}
//   wave                       → POST /api/pipeline/command {text} (preview), then
//                                {text, confirm:true, confirmIds}; a reject wave's undo is
//                                POST /api/pipeline/command/reverse {ids, text}
//   companion                  → DOWNGRADED to a Console hand-off. A companion proposal is
//                                only ever created inside a model turn of a thread
//                                (createProposal in app/_lib/db/companion.ts has no caller
//                                outside that module); there is no door that creates one
//                                from /one, and this round adds none.
import type { WorkspaceTabId } from "@/app/features/shell/tabs";
import { ACT_PARAMS } from "./actParams";
import type { ActKind } from "../types";

/** The companion catalog ids /one may name (app/_lib/companion-actions.ts). Restated as
 *  literals: importing the catalog would pull its execute graph onto a client page. */
export const COMPANION_ACTION_IDS = ["run_analysis", "generate_digest", "draft_jd", "draft_outreach"] as const;
export type CompanionActionId = (typeof COMPANION_ACTION_IDS)[number];
const isCompanionAction = (v: unknown): v is CompanionActionId => (COMPANION_ACTION_IDS as readonly unknown[]).includes(v);

/** Where in the Console each companion action is done by hand today. */
export const COMPANION_HANDOFF: Record<CompanionActionId, WorkspaceTabId> = {
  run_analysis: "analyze",
  draft_jd: "intake",
  draft_outreach: "pipeline", // the candidate drawer's outreach card
  generate_digest: "pipeline", // Candi's dock lives in the Console shell
};

/** The `reverse` door's own cap (WAVE_REVERSAL_CAP in app/api/pipeline/command/reverse.ts).
 *  A wave over it is still confirmable; its undo is then stated as unavailable here. */
export const WAVE_UNDO_CAP = 200;

/** What a press may do to the candidate's inbox. */
export type EmailEffect = "rejection" | "nextStep" | "none";

export type DisarmReason = "badParams" | "badThreshold" | "badCount" | "unknownAction";

export type ResolvedAct =
  | {
      armed: true;
      act: "entryAdvance" | "entryReject";
      action: "accept" | "reject";
      entryId: string;
      expectedStage: string;
      label: string | null;
      role: string | null;
      emails: EmailEffect;
      reversible: false;
    }
  | { armed: true; act: "wave"; mode: "reject"; threshold: number; role: string | null; text: string; emails: "rejection"; reversible: true }
  | { armed: true; act: "wave"; mode: "advance"; count: number; text: string; emails: "nextStep"; reversible: false }
  | {
      armed: true;
      act: "companion";
      action: CompanionActionId;
      /** The Console slice where it is done today — the press navigates there. */
      handoff: WorkspaceTabId;
      /** Every companion action spends a model call when run. */
      cost: "modelCall";
    }
  | {
      armed: true;
      act: "letterApprove";
      entryId: string;
      letterId: string;
      revision: number;
      label: string | null;
      preview: true;
    }
  | { armed: true; act: "letterSend"; entryId: string; letterId: string; revision: number | null; label: string | null; preview: true }
  | {
      armed: true;
      act: "interviewBook";
      entryId: string;
      /** "YYYY-MM-DD HH:MM" in the interview zone — the book door's `dateSlot`. */
      dateSlot: string;
      /** The slot's server-authored label ("Tue 10 Nov · 10:00"), when the caller had it. */
      when: string | null;
      zone: string | null;
      label: string | null;
      preview: true;
    }
  | { armed: true; act: "interviewLink"; entryId: string; label: string | null; preview: true }
  | { armed: false; act: ActKind; reason: DisarmReason };

/** Round 4: acts the card ARMS and states from real data, but whose confirm is disabled
 *  ("Wired after the pick") — no write reaches any door yet. Wiring one later is this flag
 *  plus its door in doors.ts:
 *    letterApprove → POST /api/outreach-letters/[id]/approve {revision}
 *    letterSend    → POST /api/outreach-letters/[id]/release
 *    interviewBook → POST /api/schedule {action:"book", entryId, dateSlot}
 *    interviewLink → POST /api/schedule/invite {entryId} */
export const PREVIEW_ACTS: ReadonlySet<ActKind> = new Set<ActKind>(["letterApprove", "letterSend", "interviewBook", "interviewLink"]);
export const isPreviewAct = (act: ActKind): boolean => PREVIEW_ACTS.has(act);

const DATE_SLOT = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/;

function intIn(raw: string | undefined, lo: number, hi: number): number | null {
  if (raw == null || !/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= lo && n <= hi ? n : null;
}

/** The exact command text the existing parser (app/_lib/pipeline-command.ts) reads. */
export function waveText(r: { mode: "reject"; threshold: number; role: string | null } | { mode: "advance"; count: number }): string {
  if (r.mode === "advance") return `advance top ${r.count}`;
  return r.role ? `reject below ${r.threshold}% on ${r.role}` : `reject below ${r.threshold}%`;
}

export function resolveAct(act: ActKind, params: Record<string, string>): ResolvedAct {
  const spec = ACT_PARAMS[act];
  if (Object.keys(params).some((k) => !spec.allowed.includes(k)) || spec.required.some((k) => !params[k])) {
    return { armed: false, act, reason: "badParams" };
  }
  switch (act) {
    case "entryAdvance":
    case "entryReject":
      return {
        armed: true,
        act,
        action: act === "entryAdvance" ? "accept" : "reject",
        entryId: params.entryId,
        expectedStage: params.expectedStage,
        label: params.label ?? null,
        role: params.role ?? null,
        // A reject queues the rejection letter (pipeline-entry-action.ts); an accept can
        // set off the next step's invitation (AI interview / work sample) by stage.
        emails: act === "entryReject" ? "rejection" : "nextStep",
        reversible: false,
      };
    case "wave": {
      if (params.mode === "reject") {
        const threshold = intIn(params.threshold, 1, 100);
        if (threshold === null || params.count) return { armed: false, act, reason: "badThreshold" };
        const role = params.role?.trim().slice(0, 60) || null;
        return { armed: true, act, mode: "reject", threshold, role, text: waveText({ mode: "reject", threshold, role }), emails: "rejection", reversible: true };
      }
      if (params.mode === "advance") {
        const count = intIn(params.count, 1, 50);
        if (count === null || params.threshold || params.role) return { armed: false, act, reason: "badCount" };
        return { armed: true, act, mode: "advance", count, text: waveText({ mode: "advance", count }), emails: "nextStep", reversible: false };
      }
      return { armed: false, act, reason: "badParams" };
    }
    case "companion": {
      if (!isCompanionAction(params.action)) return { armed: false, act, reason: "unknownAction" };
      return { armed: true, act, action: params.action, handoff: COMPANION_HANDOFF[params.action], cost: "modelCall" };
    }
    case "letterApprove": {
      // The approval is bound to ONE revision: a malformed one cannot be armed.
      if (!/^\d{1,6}$/.test(params.revision)) return { armed: false, act, reason: "badParams" };
      return { armed: true, act, entryId: params.entryId, letterId: params.letterId, revision: Number(params.revision), label: params.label ?? null, preview: true };
    }
    case "letterSend": {
      if (params.revision !== undefined && !/^\d{1,6}$/.test(params.revision)) return { armed: false, act, reason: "badParams" };
      return {
        armed: true,
        act,
        entryId: params.entryId,
        letterId: params.letterId,
        revision: params.revision !== undefined ? Number(params.revision) : null,
        label: params.label ?? null,
        preview: true,
      };
    }
    case "interviewBook": {
      if (!DATE_SLOT.test(params.dateSlot)) return { armed: false, act, reason: "badParams" };
      return {
        armed: true,
        act,
        entryId: params.entryId,
        dateSlot: params.dateSlot,
        when: params.when?.trim().slice(0, 60) || null,
        zone: params.zone?.trim().slice(0, 60) || null,
        label: params.label ?? null,
        preview: true,
      };
    }
    case "interviewLink":
      return { armed: true, act, entryId: params.entryId, label: params.label ?? null, preview: true };
  }
}
