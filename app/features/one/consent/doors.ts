"use client";

// The EXISTING write doors a ConsentCard press reaches — no new route. Each function
// keeps the failure's body (`{ code }`) so the card resolves the code in the reader's
// language; the server's English `error` is never carried forward.
import type { ApiErrorPayload } from "@/app/_lib/use-error-message";

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

/** POST /api/pipeline/command/reverse {ids, text} — undo a reject wave. */
export async function reverseWave(ids: string[], text: string): Promise<{ ok: true; restored: number; notified: number; skipped: number } | DoorFail> {
  const r = await post("/api/pipeline/command/reverse", { ids, text });
  if (!r.ok) return fail(r.status, r.body);
  const b = (r.body ?? {}) as Record<string, unknown>;
  return { ok: true, restored: n(b.restored), notified: n(b.notified), skipped: n(b.skipped) };
}
