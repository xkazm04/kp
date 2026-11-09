// A failed must-have (knockout) is a HELD entry, not a decision (owner ruling Q1,
// 2026-11-09, docs/product/oss-1.0-cut.md). The apply doors file a real pipeline entry
// carrying the existing `decision` approval, and a person confirms the rejection or
// clears the hold through the ordinary accept / reject door. This module is the one
// place the hold's payload is written and read, so the doors that file it, the entry
// action that sends the confirmed letter and the tests cannot drift on its shape.
//
// The payload rides `pipeline_entries.approval_detail` (no new column, no new status):
//   - `knockout.failedKoIds` — the must-have step ids the applicant answered no to,
//     which is what the confirmed letter names and what the reviewer reads;
//   - `reasonCode` / `reasonParams` — the sealed reasons block's code beside the human's
//     decision (pipeline-entry-action.ts lifts them into the record's `aiReason*`);
//   - `rationale` — the same fact in a sentence, which the Decisions analysis modal
//     already renders from approval_detail.
// It carries NO recommendation: the gate has asked a person, it has not proposed an
// outcome, so nothing here can be read as the machine's verdict.
//
// Pure and dependency-free on purpose (the writers open SQLite, the readers are routes).

import type { ApprovalKind } from "./approval-kinds";

/** The reason code the hold seals under, beside the person's accept or reject. */
export const KNOCKOUT_HOLD_REASON_CODE = "knockout";

/** A step id is one of OUR ids (applyKoSteps), but the payload is read back from a row,
 *  so the shape is re-checked instead of trusted. */
const KO_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_FAILED_IDS = 20;

function cleanIds(ids: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id === "string" && KO_ID_RE.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_FAILED_IDS) break;
  }
  return out;
}

/** The `approval_detail` of a knockout hold. */
export function knockoutHoldDetail(failedKoIds: readonly string[]): string {
  const ids = cleanIds(failedKoIds);
  return JSON.stringify({
    knockout: { failedKoIds: ids },
    reasonCode: KNOCKOUT_HOLD_REASON_CODE,
    reasonParams: { failedKo: ids.join(", ") },
    rationale: `Answered no to the must-have the role states: ${ids.join(", ")}. Nothing is decided until a person confirms the rejection or clears the hold.`,
  });
}

/** The held must-haves of an entry, or null when the entry is not a knockout hold. Both
 *  halves must agree: the `decision` approval AND the knockout payload (a Match add's
 *  `decision` approval carries none, so it can never be read as a hold). */
export function parseKnockoutHold(
  approvalKind: ApprovalKind | string | null | undefined,
  approvalDetail: string | null | undefined
): { failedKoIds: string[] } | null {
  if (approvalKind !== "decision" || !approvalDetail) return null;
  try {
    const parsed = JSON.parse(approvalDetail) as { knockout?: { failedKoIds?: unknown } } | null;
    const raw = parsed?.knockout?.failedKoIds;
    if (!Array.isArray(raw)) return null;
    const failedKoIds = cleanIds(raw);
    return failedKoIds.length > 0 ? { failedKoIds } : null;
  } catch {
    return null;
  }
}
