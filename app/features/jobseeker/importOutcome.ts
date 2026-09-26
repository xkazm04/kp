import type { JobseekerCvListItem, JobseekerProfile } from "@/app/_lib/jobseeker/types";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";

/*
 * The CV import is three hops — POST /api/extract-text, POST /api/profile/draft,
 * POST /api/jobseeker/cvs (with a reuse check before the draft, `importCv` below) —
 * and until this module existed the page collapsed
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

/** POST /api/jobseeker/cvs (the import's last hop) answers `{ profile, cv }`. */
export type RecordOutcome = { ok: true; stage: "saving"; profile: JobseekerProfile; cv: JobseekerCvListItem | null } | ImportFailure;

export function classifyRecorded(res: ResponseLike, body: { profile?: unknown; cv?: unknown; code?: unknown } | null): RecordOutcome {
  const bad = transportOrCoded("saving", res, body);
  if (bad) return bad;
  const profile = body?.profile as { id?: unknown } | undefined;
  if (!profile || typeof profile !== "object" || typeof profile.id !== "string" || !profile.id) return fail("saving", "unknown");
  return { ok: true, stage: "saving", profile: profile as unknown as JobseekerProfile, cv: cvOf(body?.cv) };
}

function cvOf(raw: unknown): JobseekerCvListItem | null {
  const cv = raw as Partial<JobseekerCvListItem> | null | undefined;
  return cv && typeof cv === "object" && typeof cv.id === "string" && typeof cv.createdAt === "string" ? (cv as JobseekerCvListItem) : null;
}

/** POST /api/jobseeker/cvs/reuse: a stored CV with this text was applied, or not. Any
 *  failure of THIS door is "not reused" — the check is an optimisation, and a seeker
 *  whose reuse lookup failed still gets their CV read (degrade, never block). */
export function classifyReuse(
  res: ResponseLike,
  body: { reused?: unknown; profile?: unknown; cv?: unknown } | null
): { profile: JobseekerProfile; cv: JobseekerCvListItem } | null {
  if (!res.ok || !body || body.reused !== true) return null;
  const profile = body.profile as { id?: unknown } | undefined;
  const cv = cvOf(body.cv);
  if (!profile || typeof profile.id !== "string" || !cv) return null;
  return { profile: profile as unknown as JobseekerProfile, cv };
}

/* ── The import, hop by hop ────────────────────────────────────────────────────
 *
 * extract-text → (reuse check) → profile/draft → record. The reuse check sits between
 * the file's text and the model: a CV already read — same text, whitespace aside — is
 * answered from the store with the draft it produced the first time, and the draft hop
 * (a model call of ~12 s) never runs. `fresh` ("Read it again") skips the check and
 * drafts anew; the record hop then replaces the stored draft.
 *
 * The page supplies `post` (a fetch that never throws), so a test drives every branch
 * without a network and can see exactly which doors were — and were not — knocked on.
 */

export type ImportPost = (url: string, init: RequestInit) => Promise<{ res: ResponseLike; body: Record<string, unknown> | null }>;

export type ImportDone = {
  ok: true;
  profile: JobseekerProfile;
  /** Which reader drafted the profile now in force (the stored one's, on a reuse). */
  source: DraftSource;
  cv: JobseekerCvListItem | null;
  /** The text was read before: its stored draft was applied and no draft ran. */
  reused: boolean;
};

export async function importCv(
  file: Blob,
  opts: { post: ImportPost; fileName?: string | null; fresh?: boolean; onStage?: (stage: ImportStage) => void }
): Promise<ImportDone | ImportFailure> {
  const { post, onStage } = opts;
  onStage?.("extracting");
  const form = new FormData();
  form.append("file", file, opts.fileName ?? undefined);
  const extracted = await post("/api/extract-text", { method: "POST", body: form });
  const extract = classifyExtract(extracted.res, extracted.body);
  if (!extract.ok) return extract;

  onStage?.("drafting");
  const jsonPost = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!opts.fresh) {
    const looked = await post("/api/jobseeker/cvs/reuse", jsonPost({ text: extract.text }));
    const hit = classifyReuse(looked.res, looked.body);
    if (hit) return { ok: true, profile: hit.profile, source: hit.cv.draftSource, cv: hit.cv, reused: true };
  }
  const drafted = await post("/api/profile/draft", jsonPost({ text: extract.text }));
  const draft = classifyDraft(drafted.res, drafted.body);
  if (!draft.ok) return draft;

  onStage?.("saving");
  const saved = await post(
    "/api/jobseeker/cvs",
    jsonPost({ text: extract.text, profile: draft.profile, draftSource: draft.source, fileName: opts.fileName ?? null, byteSize: file.size })
  );
  const stored = classifyRecorded(saved.res, saved.body);
  if (!stored.ok) return stored;
  return { ok: true, profile: stored.profile, source: draft.source, cv: stored.cv, reused: false };
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
