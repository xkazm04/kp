// The logic of the held-outreach RELEASE CARD (comms scope C2b), kept out of the component
// so it is testable without a DOM: the three calls to /api/outreach-letters and the rules
// that decide which buttons are live and what the card says happened.
//
// Nothing here retries. A stale revision is surfaced as `stale` and the card asks the
// person to reload; it never re-sends an approval for a revision they did not read.

import type { OfferLetterForecast } from "@/app/_lib/comms-letter-preview";
import type { ApiErrorPayload } from "@/app/_lib/use-error-message";

// Mirrors db/outreach-letters.ts. Not imported: that module opens the database and this
// one ships to the browser.
export type OutreachLetterState = "drafted" | "approved" | "released" | "delivery_failed" | "suppressed" | "discarded";
export const RELEASABLE_STATES: readonly OutreachLetterState[] = ["approved", "delivery_failed", "suppressed"];

export type OutreachLetterView = {
  letter: {
    id: string;
    entryId: string;
    state: OutreachLetterState;
    revision: number;
    subject: string | null;
    body: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
    releasedAt: string | null;
  };
  preview: {
    locale: string;
    subject: string;
    body: string;
    recipient: string | null;
    forecast: OfferLetterForecast;
    forecastReason: string | null;
  };
};

export type Fetcher = typeof fetch;

/** What the last action on the card said, shown inline. */
export type CardOutcome =
  | { kind: "none" }
  | { kind: "stale" }
  | { kind: "suppressed"; reason: string | null }
  | { kind: "queued" }
  | { kind: "sent" }
  | { kind: "failed" }
  | { kind: "error"; error: ApiErrorPayload };

export const canApprove = (state: OutreachLetterState): boolean => state === "drafted";
export const canRelease = (state: OutreachLetterState): boolean => RELEASABLE_STATES.includes(state);

async function readJson<T>(res: Response): Promise<T | null> {
  return (await res.json().catch(() => null)) as T | null;
}

/** The letter held for an application, or null when none was drafted. */
export async function loadLetter(entryId: string, doFetch: Fetcher = fetch): Promise<OutreachLetterView | null> {
  const res = await doFetch(`/api/outreach-letters/by-entry/${encodeURIComponent(entryId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`outreach letter lookup ${res.status}`);
  const body = await readJson<{ letter: OutreachLetterView["letter"] | null; preview: OutreachLetterView["preview"] | null }>(res);
  if (!body?.letter || !body.preview) return null;
  return { letter: body.letter, preview: body.preview };
}

/** Approve exactly the revision the card rendered. A 409 is `stale`: the letter changed
 *  (or was already approved) since it was read. */
export async function approveLetter(letterId: string, revision: number, doFetch: Fetcher = fetch): Promise<CardOutcome> {
  try {
    const res = await doFetch(`/api/outreach-letters/${encodeURIComponent(letterId)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision }),
    });
    if (res.ok) return { kind: "none" };
    if (res.status === 409) return { kind: "stale" };
    return { kind: "error", error: (await readJson<ApiErrorPayload>(res)) ?? {} };
  } catch {
    // best-effort: a network failure is reported as a generic error, never retried here
    return { kind: "error", error: {} };
  }
}

/** Release an approved letter. `queued` is the keyless truth: recorded in the local
 *  outbox, not delivered to anyone. */
export async function releaseLetter(letterId: string, doFetch: Fetcher = fetch): Promise<CardOutcome> {
  try {
    const res = await doFetch(`/api/outreach-letters/${encodeURIComponent(letterId)}/release`, { method: "POST" });
    const body = await readJson<ApiErrorPayload & { delivery?: string; suppressed?: string }>(res);
    if (res.ok) {
      if (body?.delivery === "failed") return { kind: "failed" };
      return body?.delivery === "sent" ? { kind: "sent" } : { kind: "queued" };
    }
    if (res.status === 409 && body?.code === "COMMS_SUPPRESSED") return { kind: "suppressed", reason: body.suppressed ?? null };
    return { kind: "error", error: body ?? {} };
  } catch {
    // best-effort: a network failure is reported as a generic error, never retried here
    return { kind: "error", error: {} };
  }
}
