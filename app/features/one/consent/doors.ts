"use client";

// The EXISTING write doors a ConsentCard press reaches — no new route. Each function
// keeps the failure's body (`{ code }`) so the card resolves the code in the reader's
// language; the server's English `error` is never carried forward.
import type { ApiErrorPayload } from "@/app/_lib/use-error-message";
import { parseBookingConfirmation, type BookingConfirmation } from "../tools/parse";

export type DoorFail = { ok: false; status: number; payload: ApiErrorPayload | null; stale: boolean };

/** Codes that mean "the row moved under you" — the card says refresh, not "failed". */
const STALE_CODES = new Set(["PIPELINE_STAGE_CHANGED", "PIPELINE_MOVE_CONFLICT", "PIPELINE_ENTRY_NOT_FOUND", "PIPELINE_NOT_REINSTATABLE"]);

async function post(url: string, body: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  } catch {
    // A network failure has no body and no code: the card shows its own localized line.
    return { ok: false, status: 0, body: null };
  }
}

function fail(status: number, body: unknown): DoorFail {
  const code = body != null && typeof body === "object" && typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : null;
  return { ok: false, status, payload: code ? { code } : null, stale: code !== null && STALE_CODES.has(code) };
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** POST /api/pipeline/[id] {action, expectedStage} — the board's own decide door. */
export async function entryAct(
  entryId: string,
  action: "accept" | "reject",
  expectedStage: string
): Promise<{ ok: true; commsFailed: boolean; routedToHumanRound: boolean } | DoorFail> {
  const r = await post(`/api/pipeline/${encodeURIComponent(entryId)}`, { action, expectedStage });
  if (!r.ok) return fail(r.status, r.body);
  const b = (r.body ?? {}) as { commsFailed?: unknown; routedToHumanRound?: unknown };
  return { ok: true, commsFailed: b.commsFailed === true, routedToHumanRound: b.routedToHumanRound === true };
}

export type WavePreview = {
  rows: { id: string; label: string; jobTitle: string | null; score: number | null }[];
  total: number;
  matchedIds: string[];
};

/** POST /api/pipeline/command {text} — the preview; executes nothing. */
export async function previewWave(text: string): Promise<({ ok: true } & WavePreview) | DoorFail> {
  const r = await post("/api/pipeline/command", { text });
  if (!r.ok) return fail(r.status, r.body);
  const b = (r.body ?? {}) as { preview?: unknown; total?: unknown; matchedIds?: unknown };
  if (!Array.isArray(b.preview)) return fail(r.status, null);
  const rows = (b.preview as Record<string, unknown>[]).flatMap((p) =>
    typeof p?.id === "string"
      ? [{ id: p.id, label: typeof p.label === "string" ? p.label : p.id, jobTitle: typeof p.jobTitle === "string" ? p.jobTitle : null, score: typeof p.score === "number" ? p.score : null }]
      : []
  );
  const matchedIds = Array.isArray(b.matchedIds) ? (b.matchedIds as unknown[]).filter((x): x is string => typeof x === "string") : rows.map((x) => x.id);
  return { ok: true, rows, total: n(b.total), matchedIds };
}

export type WaveResult = { count: number; failed: number; commsFailed: number; heldAtOffer: number; droppedOut: number };

/** POST /api/pipeline/command {text, confirm:true, confirmIds} — a reject wave binds to
 *  the PREVIEWED ids, so nobody who slipped under the line after the preview is touched. */
export async function confirmWave(text: string, confirmIds: string[] | null): Promise<({ ok: true } & WaveResult) | DoorFail> {
  const r = await post("/api/pipeline/command", { text, confirm: true, ...(confirmIds ? { confirmIds } : {}) });
  if (!r.ok) return fail(r.status, r.body);
  const b = (r.body ?? {}) as Record<string, unknown>;
  return { ok: true, count: n(b.count), failed: n(b.failed), commsFailed: n(b.commsFailed), heldAtOffer: n(b.heldAtOffer), droppedOut: n(b.droppedOut) };
}

/** The truthful delivery claim the send doors answer (comms-truth deliveryClaim). */
export type Delivery = "sent" | "queued" | "failed";
const delivery = (v: unknown): Delivery => (v === "sent" || v === "queued" ? v : "failed");

/** POST /api/outreach-letters/[id]/approve {revision} — a NAMED person approves the revision
 *  they read; nothing is sent. 403 OUTREACH_APPROVER_UNNAMED, 409 OUTREACH_LETTER_CONFLICT. */
export async function approveLetter(letterId: string, revision: number): Promise<{ ok: true; revision: number; approvedBy: string | null } | DoorFail> {
  const r = await post(`/api/outreach-letters/${encodeURIComponent(letterId)}/approve`, { revision });
  if (!r.ok) return fail(r.status, r.body);
  const l = ((r.body ?? {}) as { letter?: { revision?: unknown; approvedBy?: unknown } }).letter ?? {};
  return { ok: true, revision: n(l.revision) || revision, approvedBy: typeof l.approvedBy === "string" ? l.approvedBy : null };
}

/** POST /api/outreach-letters/[id]/release — the ONE door that sends an approved letter.
 *  409 OUTREACH_APPROVAL_STALE (changed after approval: nothing sent, back to draft). */
export async function releaseLetter(letterId: string): Promise<{ ok: true; delivery: Delivery } | DoorFail> {
  const r = await post(`/api/outreach-letters/${encodeURIComponent(letterId)}/release`, {});
  if (!r.ok) return fail(r.status, r.body);
  return { ok: true, delivery: delivery((r.body as { delivery?: unknown } | null)?.delivery) };
}

/** POST /api/schedule {action:"book", entryId, dateSlot} — the week grid's book door. It also
 *  mails the candidate their confirmation; `confirmation` is what that did (null = not said). */
export async function bookInterview(
  entryId: string,
  dateSlot: string
): Promise<{ ok: true; slot: string | null; confirmation: BookingConfirmation | null } | DoorFail> {
  const r = await post("/api/schedule", { action: "book", entryId, dateSlot });
  if (!r.ok) return fail(r.status, r.body);
  const b = (r.body ?? {}) as { slot?: unknown; confirmation?: unknown };
  return { ok: true, slot: typeof b.slot === "string" ? b.slot : null, confirmation: parseBookingConfirmation(b.confirmation) };
}

/** POST /api/schedule/invite {entryId} — mint a self-scheduling link and mail it. */
export async function sendScheduleLink(entryId: string): Promise<{ ok: true; delivery: Delivery } | DoorFail> {
  const r = await post("/api/schedule/invite", { entryId });
  if (!r.ok) return fail(r.status, r.body);
  return { ok: true, delivery: delivery((r.body as { delivery?: unknown } | null)?.delivery) };
}

/** POST /api/pipeline/command/reverse {ids, text} — undo a reject wave. */
export async function reverseWave(ids: string[], text: string): Promise<{ ok: true; restored: number; notified: number; skipped: number } | DoorFail> {
  const r = await post("/api/pipeline/command/reverse", { ids, text });
  if (!r.ok) return fail(r.status, r.body);
  const b = (r.body ?? {}) as Record<string, unknown>;
  return { ok: true, restored: n(b.restored), notified: n(b.notified), skipped: n(b.skipped) };
}
