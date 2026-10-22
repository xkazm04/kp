// The logic of the BULK DRY-RUN SHEET (comms scope C2b, second half): a cohort of held
// first-contact letters read together, forecast together, and approved + released together.
//
// It forks nothing. Each letter is read through the release card's own lookup (loadLetter,
// the one letter view the drawer renders), and each is approved and released through the
// release card's own calls (approveLetter / releaseLetter, the per-letter CAS and release
// doors). There is no second send path: N letters are N sequential POSTs to the one door,
// each carrying that letter's own approved revision and naming the human approver. A letter
// that changed after the sheet rendered it is refused by that door with a 409 and reported
// as `conflict`; the rest of the cohort carries on.

import {
  approveLetter,
  canApprove,
  canRelease,
  loadLetter,
  releaseLetter,
  type Fetcher,
  type OutreachLetterView,
} from "./outreachCard";

/** One row of the sheet. `view` is null when no letter was drafted for the application. */
export type CohortLetter = { entryId: string; view: OutreachLetterView | null; loadFailed?: boolean };

/** What the delivery forecast says a letter will do on release. */
export type ForecastKind = "send" | "queue" | "refuse";

export type CohortForecast = {
  /** Handed to a mail relay. */
  send: number;
  /** Keyless / simulation: recorded in the local outbox, nobody receives it. */
  queue: number;
  /** Cannot be contacted (no recipient, or consent / erasure / a halted sequence). */
  refuse: number;
  /** Held letters already released or discarded: nothing left to do. */
  settled: number;
  /** Rows with no letter, or whose lookup failed. */
  missing: number;
  /** Why the refused ones are refused, counted by reason token. */
  refuseReasons: Record<string, number>;
};

export function isSettled(state: OutreachLetterView["letter"]["state"]): boolean {
  return state === "released" || state === "discarded";
}

/** The forecast of ONE letter, read off the preview the sheet shows (the send path's own
 *  predicates, as letter-view.ts evaluates them). */
export function forecastKind(preview: OutreachLetterView["preview"]): ForecastKind {
  switch (preview.forecast) {
    case "relay":
      return "send";
    case "local":
    case "simulation":
      return "queue";
    case "refused":
    case "suppressed":
      return "refuse";
  }
}

/** The reason token a refused letter is refused for. */
export function refuseReason(preview: OutreachLetterView["preview"]): string {
  return preview.forecastReason ?? (preview.recipient === null ? "no_recipient" : "other");
}

/** The cohort forecast. Every count is derived from the same per-letter forecast the rows
 *  show, so the totals and the rows cannot disagree. */
export function cohortForecast(rows: readonly CohortLetter[]): CohortForecast {
  const out: CohortForecast = { send: 0, queue: 0, refuse: 0, settled: 0, missing: 0, refuseReasons: {} };
  for (const row of rows) {
    if (!row.view) {
      out.missing += 1;
      continue;
    }
    if (isSettled(row.view.letter.state)) {
      out.settled += 1;
      continue;
    }
    const kind = forecastKind(row.view.preview);
    out[kind] += 1;
    if (kind === "refuse") {
      const reason = refuseReason(row.view.preview);
      out.refuseReasons[reason] = (out.refuseReasons[reason] ?? 0) + 1;
    }
  }
  return out;
}

/** Read the cohort's letters, a few at a time. Never throws: a failed lookup is a row. */
export async function loadCohort(entryIds: readonly string[], doFetch: Fetcher = fetch, concurrency = 4): Promise<CohortLetter[]> {
  const rows: CohortLetter[] = entryIds.map((entryId) => ({ entryId, view: null }));
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const i = next++;
      const entryId = rows[i].entryId;
      try {
        rows[i] = { entryId, view: await loadLetter(entryId, doFetch) };
      } catch {
        // best-effort: a lookup that failed is shown as such on its row, never fatal
        rows[i] = { entryId, view: null, loadFailed: true };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return rows;
}

/** The per-letter answer of a bulk Approve and Release. */
export type BulkLetterResult =
  | { letterId: string; entryId: string; kind: "released" }
  | { letterId: string; entryId: string; kind: "queued" }
  | { letterId: string; entryId: string; kind: "refused"; reason: string }
  | { letterId: string; entryId: string; kind: "conflict" };

async function approveAndRelease(
  entryId: string,
  view: OutreachLetterView,
  doFetch: Fetcher
): Promise<BulkLetterResult> {
  const { letter, preview } = view;
  const base = { letterId: letter.id, entryId };
  if (forecastKind(preview) === "refuse") return { ...base, kind: "refused", reason: refuseReason(preview) };
  if (canApprove(letter.state)) {
    // The revision the sheet RENDERED for this letter, not a fresh read.
    const approved = await approveLetter(letter.id, letter.revision, doFetch);
    if (approved.kind === "stale") return { ...base, kind: "conflict" };
    if (approved.kind !== "none") return { ...base, kind: "refused", reason: "error" };
  } else if (!canRelease(letter.state)) {
    return { ...base, kind: "conflict" };
  }
  const released = await releaseLetter(letter.id, doFetch);
  switch (released.kind) {
    case "sent":
      return { ...base, kind: "released" };
    case "queued":
      return { ...base, kind: "queued" };
    case "suppressed":
      return { ...base, kind: "refused", reason: released.reason ?? "other" };
    case "failed":
      return { ...base, kind: "refused", reason: "delivery_failed" };
    case "error":
      // The release door's own 409: not approved, already released, or being released.
      return released.error.code === "PIPELINE_MOVE_CONFLICT"
        ? { ...base, kind: "conflict" }
        : { ...base, kind: "refused", reason: released.error.code ?? "error" };
    default:
      return { ...base, kind: "refused", reason: "error" };
  }
}

/**
 * Approve and release every actionable letter, one at a time, through the per-letter
 * doors. A letter edited since the sheet rendered it is refused with a 409 by the approve
 * door and reported `conflict`. A letter whose forecast is already a refusal is not sent
 * to the door and is reported `refused` with the forecast's reason. Settled and missing
 * rows are not part of the run.
 */
export async function approveAndReleaseCohort(
  rows: readonly CohortLetter[],
  doFetch: Fetcher = fetch,
  onProgress?: (done: number, total: number) => void
): Promise<BulkLetterResult[]> {
  const todo = rows.filter((r): r is CohortLetter & { view: OutreachLetterView } => !!r.view && !isSettled(r.view.letter.state));
  const results: BulkLetterResult[] = [];
  for (const { entryId, view } of todo) {
    results.push(await approveAndRelease(entryId, view, doFetch));
    onProgress?.(results.length, todo.length);
  }
  return results;
}

/** Counts of a finished run, by kind. */
export function tallyResults(results: readonly BulkLetterResult[]): Record<BulkLetterResult["kind"], number> {
  const out = { released: 0, queued: 0, refused: 0, conflict: 0 };
  for (const r of results) out[r.kind] += 1;
  return out;
}
