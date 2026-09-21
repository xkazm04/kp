import type { JobseekerProfile } from "@/app/_lib/jobseeker/types";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";

/*
 * The CV import is three hops — POST /api/extract-text, POST /api/profile/draft,
 * PUT /api/jobseeker/profile — and until this module existed the page collapsed
 * every way each of them can end into ONE red sentence per hop. Three different
 * failures read identically at the first hop alone: a file we genuinely cannot
 * read (a coded refusal, EXTRACT_TEXT_UNREADABLE), a PDF that extracted cleanly
 * and is simply a picture of a CV (`200 {text: ""}` — the scan with no text
 * layer), and the server never answering in JSON at all (a proxy page, an
 * offline laptop). Only the first is about the file; the second has a precise
 * remedy the reader can act on; the third is not about the CV at all.
 *
 * "Loss must never masquerade as absence" (cv-parsing-and-career-reading /
 * degraded-intake-as-a-visible-queue): an empty read is a LOSS and has to say so.
 *
 * So the classification is a closed vocabulary, pure and testable, and the page
 * only paints it. `reason` — never a message — is what crosses this boundary:
 * `coded` carries the server's machine code for useErrorMessage() to resolve in
 * the reader's language, and the other three resolve to copy the page owns.
 */

export const IMPORT_STAGES = ["extracting", "drafting", "saving"] as const;
export type ImportStage = (typeof IMPORT_STAGES)[number];

/** The four ways a hop can end badly. `unknown` is the honest last resort: the
 *  response WAS JSON and was not ok, but carried no code we could resolve. */
export type ImportFailureReason = "noTextLayer" | "coded" | "transport" | "unknown";

export type ImportFailure = {
  ok: false;
  stage: ImportStage;
  reason: ImportFailureReason;
  /** Present only on `coded`; the machine code from the route's `{ error, code }`. */
  code: string | null;
};

/** Which reader drafted the profile. `null` = the route did not say, so the page
 *  claims NEITHER — an absent field must not be reported as "a model read this". */
export type DraftSource = "llm" | "deterministic" | null;

export type ExtractOutcome = { ok: true; stage: "extracting"; text: string } | ImportFailure;
export type DraftOutcome = { ok: true; stage: "drafting"; profile: ProfilePayload; source: DraftSource } | ImportFailure;
export type SaveOutcome = { ok: true; stage: "saving"; profile: JobseekerProfile } | ImportFailure;

/** What a classifier needs off a `Response`: whether it was a 2xx. Structural on
 *  purpose so a test passes `{ ok: false }` instead of building a Response. */
export type ResponseLike = { ok: boolean };

function fail(stage: ImportStage, reason: ImportFailureReason, code: string | null = null): ImportFailure {
  return { ok: false, stage, reason, code };
}

/** A body of `null` means the JSON parse itself failed (`.json().catch(() => null)`)
 *  or the fetch never resolved — in both cases nothing the server said reached us,
 *  which is a TRANSPORT fault and not a verdict on the file. */
function transportOrCoded(stage: ImportStage, res: ResponseLike, body: { code?: unknown } | null): ImportFailure | null {
  if (body === null || body === undefined) return fail(stage, "transport");
  if (res.ok) return null;
  const code = typeof body.code === "string" && body.code.trim() ? body.code : null;
  return code ? fail(stage, "coded", code) : fail(stage, "unknown");
}

export function classifyExtract(res: ResponseLike, body: { text?: unknown; code?: unknown } | null): ExtractOutcome {
  const bad = transportOrCoded("extracting", res, body);
  if (bad) return bad;
  const text = typeof body?.text === "string" ? body.text : "";
  // The extractor SUCCEEDED and found nothing: app/api/extract-text/route.ts
  // answers `200 { text: "" }` for a PDF whose pages are images. The remedy is
  // specific (export it with a text layer), so it gets its own reason.
  if (!text.trim()) return fail("extracting", "noTextLayer");
  return { ok: true, stage: "extracting", text };
}

export function classifyDraft(
  res: ResponseLike,
  body: { profile?: unknown; source?: unknown; code?: unknown } | null
): DraftOutcome {
  const bad = transportOrCoded("drafting", res, body);
  if (bad) return bad;
  const profile = body?.profile;
  if (!profile || typeof profile !== "object") return fail("drafting", "unknown");
  // profile_draft_cli sets `source` to "llm" or "deterministic"; anything else —
  // including the field being absent — is "we were not told".
  const source: DraftSource = body?.source === "deterministic" ? "deterministic" : body?.source === "llm" ? "llm" : null;
  return { ok: true, stage: "drafting", profile: profile as ProfilePayload, source };
}

export function classifySave(res: ResponseLike, body: { id?: unknown; code?: unknown } | null): SaveOutcome {
  const bad = transportOrCoded("saving", res, body);
  if (bad) return bad;
  if (!body || typeof body.id !== "string" || !body.id) return fail("saving", "unknown");
  return { ok: true, stage: "saving", profile: body as unknown as JobseekerProfile };
}

/* ── How "no model read this" survives a reload ───────────────────────────────
 *
 * The draft's `source` is a property of the RUN, not of the stored row: nothing
 * in the seeker's profile records which reader produced it, and adding a column
 * for a disclosure line is not worth a migration. So it is kept per profile id
 * in sessionStorage — the note therefore survives a reload of /me for as long as
 * the tab lives, and a later import over the same profile overwrites it. A new
 * tab shows no note rather than a stale one, which is the safe direction: the
 * claim we must never make is the positive one.
 */

export function draftSourceKey(profileId: string): string {
  return `kp-me-draft-source:${profileId}`;
}

export function rememberDraftSource(profileId: string, source: DraftSource): void {
  if (!source) return;
  try {
    sessionStorage.setItem(draftSourceKey(profileId), source);
  } catch {
    /* best-effort: the disclosure is re-derived on the next import; a private
       window with storage denied must not break the save that just succeeded */
  }
}

export function recallDraftSource(profileId: string): DraftSource {
  try {
    const raw = sessionStorage.getItem(draftSourceKey(profileId));
    return raw === "deterministic" || raw === "llm" ? raw : null;
  } catch {
    /* best-effort: no storage means no claim either way, which is the honest default */
    return null;
  }
}
