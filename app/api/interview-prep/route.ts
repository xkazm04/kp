import { NextRequest, NextResponse } from "next/server";
import {
  getInterviewPrep,
  listPreparedEntries,
  prepJdEditedAt,
  resolvePendingPlan,
  saveInterviewPrep,
  saveInterviewPrepKitOverlay,
  saveInterviewPrepProgress,
} from "@/app/_lib/interview-prep";
import { parseKitOverlayWrite, prepKitForEntry } from "@/app/_lib/interview-prep-kit";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { MAX_ENTRY_ID_LEN, parseEntriesParam } from "@/app/_lib/entries-param";
import { assignImportedBlock, mergeImportedQuestions, normalizeIncoming, readImportedEntries, MAX_BLOCK_REF_LEN, MAX_IMPORT_QUESTION_LEN } from "./importMerge.ts";


// Caps for the interviewer-progress write (PREP2). Bounded so a crafted body can't
// balloon the artifact payload: the checklist has a few dozen keys, notes is a
// scratchpad, not a document.
const MAX_NOTES_LENGTH = 8 * 1024;
const MAX_CHECKED_KEYS = 200;
const MAX_INTERVIEWER_LENGTH = 120; // a name/email, never long

// Abuse containment on the THREE write verbs (/perfect wave 37, lib-voice-interview-11).
// Every one of them is a read-merge-write against the prep artifact, and the surface is
// operator-gated — which open mode (KP_OPERATOR_PASSWORD unset) makes a documented no-op
// for the whole API, so this is the real bound. Deliberately generous: the interviewer's
// checklist/notes PUT is debounced at 600 ms and fires all through a live interview, so a
// tight budget would throttle the one caller the door exists for. 600/10 min still caps a
// script at one write a second, which is what containment means here. The read GET is not
// metered: it is a point read the modal issues on open.
const PREP_WRITE_RATE_LIMIT = { limit: 600, windowMs: 10 * 60_000 };

// The PATCH body: a weave `{ question, blockRef }` is a few hundred bytes; a kit overlay
// is bounded by its own caps (interview-kit-overlay.ts — 120 drops, 120 rewrites of at
// most 600 characters, 6 additions), which is ~100 KB at the absolute ceiling. 256 KB
// leaves room for escaping and stops a crafted body being parsed before any cap runs.
const MAX_PATCH_BODY_BYTES = 256 * 1024;

// Read interview-prep artifacts (generated via the background task interview_prep).
//   GET ?entry=<id>          → the artifact for one pipeline entry (or null), the
//                              linked JD's last edit, and `kit`: the job interview kit
//                              this candidate's interview runs on (or null)
//   GET ?entries=a,b,c       → { prepared: { <entryId>: createdAt } }
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const entry = sp.get("entry");
    const ws = await currentWorkspace();
    if (entry) {
      // Direction 1 — `jdEditedAt` is the linked JD's last content edit, so the modal
      // can flag a pack built against since-changed JD text (it compares against the
      // prep's createdAt). null when the entry has no JD-backed job — no chip.
      // TENANCY — both halves scoped to the authenticated team. The read used to be
      // `getInterviewPrep(entry)`: an entry id alone, matched across every workspace,
      // while the jdEditedAt beside it was already scoped. Same predicate on both now.
      // `kit` — the job interview kit this candidate's interview runs on (the version
      // their open link pinned, else the role's latest published one), so the modal can
      // show which questions come from the kit and let the recruiter overlay them. Same
      // tenant as the pack; null when the role has no kit.
      return NextResponse.json({
        prep: getInterviewPrep(entry, ws),
        jdEditedAt: prepJdEditedAt(entry, ws),
        kit: prepKitForEntry(entry, ws),
      });
    }
    // Bounded + de-duped at the trust boundary so a crafted/huge `entries` list
    // can't blow the SQLite variable limit or amplify the IN query (idea-191ccc0c).
    const entries = parseEntriesParam(sp.get("entries"));
    return NextResponse.json({ prepared: listPreparedEntries(entries, ws) });
  } catch (error) {
    return safeJsonError(error, "api:interview-prep", "INTERVIEW_PREP_FAILED");
  }
}

// PUT ?entry=<id> → persist the interviewer's checklist + notes + assigned
// interviewer (PREP2/PREP5) onto an existing prep artifact, in ONE write so the
// human inputs can't race. Validated at the boundary: a bounded checked map of
// booleans, a length-capped notes string, and a capped interviewer name. 404 when
// no artifact exists yet (the plan must be generated before inputs can attach).
export async function PUT(request: NextRequest) {
  try {
    // AUTHORIZATION (write-routes-check-a-capability). This surface asked NOTHING —
    // not even requireOperator — so authority came down to holding a session, and the
    // entry id is the only other thing the write needs. Every verb here is a recruiter
    // act on another person’s hiring record, so each asks `pipeline:write`. It runs
    // FIRST, ahead of the entry check and the throttle, so a refused seat can neither
    // spend rate-limit budget nor learn which entry ids exist.
    const under = await requireCapabilityCoded("pipeline:write", requireCapability);
    if (under) return under;
    const entry = request.nextUrl.searchParams.get("entry");
    if (!entry || !entry.trim() || entry.length > MAX_ENTRY_ID_LEN) {
      return jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400);
    }
    if (!rateLimit(`interview-prep:${clientIpFrom(request.headers)}`, PREP_WRITE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // TENANCY: prove this team owns the artifact BEFORE the merge write. The write
    // path (saveInterviewPrepProgress) is keyed by the globally-unique entry id, so
    // without this an id from another team's board saved that team's interviewer,
    // checklist and notes. Same 404 as "no artifact yet" — the two are indistinguishable
    // to a caller who does not hold the entry, deliberately.
    const ws = await currentWorkspace();
    if (!getInterviewPrep(entry, ws)) {
      return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
    }
    const body = (await request.json().catch(() => ({}))) as { checked?: unknown; notes?: unknown; interviewer?: unknown };

    const checked: Record<string, boolean> = {};
    if (body.checked && typeof body.checked === "object") {
      for (const [k, v] of Object.entries(body.checked as Record<string, unknown>)) {
        if (Object.keys(checked).length >= MAX_CHECKED_KEYS) break;
        if (typeof k === "string" && k.length <= 64 && v === true) checked[k] = true;
      }
    }
    const notes = typeof body.notes === "string" ? body.notes.slice(0, MAX_NOTES_LENGTH) : "";
    const interviewer = typeof body.interviewer === "string" ? body.interviewer.slice(0, MAX_INTERVIEWER_LENGTH) : "";

    const ok = saveInterviewPrepProgress(entry, { checked, notes, interviewer });
    if (!ok) {
      return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeJsonError(error, "api:interview-prep", "INTERVIEW_PREP_FAILED");
  }
}

// POST ?entry=<id> → import a report's interview-kit questions into the entry's
// EXISTING prep pack (Direction 2). The questions land under a dedicated
// `importedQuestions` key that mergeRegeneratedPrep preserves across a Regenerate,
// so an import survives re-generating the plan. Idempotent: deduped by content so
// re-posting the same kit never stacks copies. 404 when no pack exists yet (the
// plan must be generated before questions can attach — same contract as the PUT).
export async function POST(request: NextRequest) {
  try {
    // AUTHORIZATION (write-routes-check-a-capability). This surface asked NOTHING —
    // not even requireOperator — so authority came down to holding a session, and the
    // entry id is the only other thing the write needs. Every verb here is a recruiter
    // act on another person’s hiring record, so each asks `pipeline:write`. It runs
    // FIRST, ahead of the entry check and the throttle, so a refused seat can neither
    // spend rate-limit budget nor learn which entry ids exist.
    const under = await requireCapabilityCoded("pipeline:write", requireCapability);
    if (under) return under;
    const entry = request.nextUrl.searchParams.get("entry");
    if (!entry || !entry.trim() || entry.length > MAX_ENTRY_ID_LEN) {
      return jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400);
    }
    const body = (await request.json().catch(() => ({}))) as { questions?: unknown };
    const incoming = normalizeIncoming(body.questions);
    if (incoming.length === 0) {
      return jsonRefusal("INTERVIEW_PREP_QUESTIONS_REQUIRED", 400);
    }
    if (!rateLimit(`interview-prep:${clientIpFrom(request.headers)}`, PREP_WRITE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // Read-merge-write through the existing full-payload save path (getInterviewPrep +
    // saveInterviewPrep) — no parallel store, no new persistence function. Preserve
    // every other payload key (generated plan, userProgress, humanScorecard).
    // TENANCY — scoped to the authenticated team, so a foreign entry id can neither
    // read the pack back nor have questions merged into it.
    const existing = getInterviewPrep(entry, await currentWorkspace());
    if (!existing) {
      return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
    }
    const prior = readImportedEntries(existing.payload);
    const merged = mergeImportedQuestions(prior, incoming);
    const added = merged.length - prior.length;
    if (added > 0) {
      saveInterviewPrep(entry, existing.candidateLabel, existing.jobTitle, { ...existing.payload, importedQuestions: merged });
    }
    return NextResponse.json({ ok: true, added, total: merged.length });
  } catch (error) {
    return safeJsonError(error, "api:interview-prep", "INTERVIEW_PREP_FAILED");
  }
}

// PATCH ?entry=<id> → weave an imported question into a chronology block, or unassign
// it (Direction 3). Body: { question: string, blockRef: string | null }. The question
// stays in importedQuestions and only gains/loses a `blockRef` (the target block's
// topic) — the single-home model, so it's never duplicated into the generator-owned
// chronology (Regenerate would wipe that) and the voice brief reading importedQuestions
// sees the one key. Idempotent; 404 when no pack exists, 400 on a missing question.
//
// PATCH ?entry=<id> { kitOverlay } → REPLACE the recruiter's per-candidate overlay on the
// job interview kit (spark interview-kit-template, WP-C): questions dropped, rewritten
// or added for THIS candidate only. Stored under the human-owned `kitOverlay` payload
// key, which mergeRegeneratedPrep carries across a Regenerate and the agenda reads at
// connect. A body naming `kitOverlay` is an overlay write and nothing else — the weave
// fields beside it are ignored. Refusals: INTERVIEW_PREP_OVERLAY_INVALID (400, with
// `reason` as data) for a malformed or over-cap overlay; the same gate, throttle,
// tenancy read and 404 as the weave.
//
// PATCH ?entry=<id> { plan: "accept" | "discard" } → decide a STAGED regeneration (r09
// schedule-interview-prep/B): a Regenerate started from the prep modal parks its plan
// under `payload.pendingPlan` and the modal shows the diff. Accept swaps it in and moves
// created_at (accepting IS the regeneration); discard drops it. Idempotent rather than
// coded: with no pending plan (a second click, another tab already decided) it answers
// 200 `{ applied: false }` and writes nothing. Same gate, throttle and tenancy read as
// the weave; `plan` with any other value is not a plan decision and falls through to it.
export async function PATCH(request: NextRequest) {
  try {
    // AUTHORIZATION (write-routes-check-a-capability). This surface asked NOTHING —
    // not even requireOperator — so authority came down to holding a session, and the
    // entry id is the only other thing the write needs. Every verb here is a recruiter
    // act on another person’s hiring record, so each asks `pipeline:write`. It runs
    // FIRST, ahead of the entry check and the throttle, so a refused seat can neither
    // spend rate-limit budget nor learn which entry ids exist.
    const under = await requireCapabilityCoded("pipeline:write", requireCapability);
    if (under) return under;
    const entry = request.nextUrl.searchParams.get("entry");
    if (!entry || !entry.trim() || entry.length > MAX_ENTRY_ID_LEN) {
      return jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400);
    }
    const body = await readJsonWithLimit<{ question?: unknown; blockRef?: unknown; kitOverlay?: unknown; plan?: unknown }>(
      request,
      MAX_PATCH_BODY_BYTES,
      {}
    );
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_PATCH_BODY_BYTES });

    if (body.plan === "accept" || body.plan === "discard") {
      if (!rateLimit(`interview-prep:${clientIpFrom(request.headers)}`, PREP_WRITE_RATE_LIMIT)) {
        return jsonRefusal("TOO_MANY_REQUESTS", 429);
      }
      // TENANCY — the read that authorizes every sibling verb authorizes this one: a
      // foreign entry id is the "no pack" 404, never a plan swapped on another team.
      if (!getInterviewPrep(entry, await currentWorkspace())) {
        return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
      }
      const outcome = resolvePendingPlan(entry, body.plan);
      if (!outcome.applied) return NextResponse.json({ ok: true, applied: false });
      // Accept answers the swapped-in pack so the modal re-seeds from the server's copy.
      return NextResponse.json({
        ok: true,
        applied: true,
        ...(body.plan === "accept" ? { prep: { payload: outcome.payload, createdAt: outcome.createdAt } } : {}),
      });
    }

    if (Object.prototype.hasOwnProperty.call(body, "kitOverlay")) {
      // The ONE trust boundary for an overlay write (interview-prep-kit.ts): stricter than
      // the read-side coercer, because a recruiter asked for exactly this to be stored and
      // must be told — not find their edit missing at the next open — when it cannot be.
      const parsed = parseKitOverlayWrite(body.kitOverlay);
      if (!parsed.ok) return jsonRefusal("INTERVIEW_PREP_OVERLAY_INVALID", 400, { reason: parsed.reason });
      if (!rateLimit(`interview-prep:${clientIpFrom(request.headers)}`, PREP_WRITE_RATE_LIMIT)) {
        return jsonRefusal("TOO_MANY_REQUESTS", 429);
      }
      // TENANCY — the same read-that-authorizes as every other verb here: a foreign entry
      // id answers the "no pack" 404, never a write into another team's plan.
      if (!getInterviewPrep(entry, await currentWorkspace())) {
        return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
      }
      if (!saveInterviewPrepKitOverlay(entry, parsed.overlay)) {
        return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
      }
      return NextResponse.json({ ok: true, kitOverlay: parsed.overlay });
    }

    const question = typeof body.question === "string" ? body.question.trim().slice(0, MAX_IMPORT_QUESTION_LEN) : "";
    if (!question) {
      return jsonRefusal("INTERVIEW_PREP_QUESTION_REQUIRED", 400);
    }
    if (!rateLimit(`interview-prep:${clientIpFrom(request.headers)}`, PREP_WRITE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // null / "" / missing ⇒ unassign; otherwise the target block's topic (bounded).
    const blockRef = typeof body.blockRef === "string" && body.blockRef.trim() ? body.blockRef.trim().slice(0, MAX_BLOCK_REF_LEN) : null;

    // TENANCY — as the POST above: the weave writes back into the pack, so the
    // workspace predicate rides the read that authorizes it.
    const existing = getInterviewPrep(entry, await currentWorkspace());
    if (!existing) {
      return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
    }
    const prior = readImportedEntries(existing.payload);
    const merged = assignImportedBlock(prior, question, blockRef);
    // Only write when something actually changed (idempotent no-op stays cheap).
    if (JSON.stringify(merged) !== JSON.stringify(prior)) {
      saveInterviewPrep(entry, existing.candidateLabel, existing.jobTitle, { ...existing.payload, importedQuestions: merged });
    }
    return NextResponse.json({ ok: true, importedQuestions: merged });
  } catch (error) {
    return safeJsonError(error, "api:interview-prep", "INTERVIEW_PREP_FAILED");
  }
}
