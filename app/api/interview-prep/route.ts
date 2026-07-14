import { NextRequest, NextResponse } from "next/server";
import { getInterviewPrep, listPreparedEntries, prepJdEditedAt, saveInterviewPrep, saveInterviewPrepProgress } from "@/app/_lib/interview-prep";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";
import { MAX_ENTRY_ID_LEN, parseEntriesParam } from "@/app/_lib/entries-param";
import { mergeImportedQuestions, normalizeIncoming, readImported } from "./importMerge.ts";


// Caps for the interviewer-progress write (PREP2). Bounded so a crafted body can't
// balloon the artifact payload: the checklist has a few dozen keys, notes is a
// scratchpad, not a document.
const MAX_NOTES_LENGTH = 8 * 1024;
const MAX_CHECKED_KEYS = 200;
const MAX_INTERVIEWER_LENGTH = 120; // a name/email, never long

// Read interview-prep artifacts (generated via the background task interview_prep).
//   GET ?entry=<id>          → the artifact for one pipeline entry (or null)
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
      return NextResponse.json({ prep: getInterviewPrep(entry), jdEditedAt: prepJdEditedAt(entry, ws) });
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
    const entry = request.nextUrl.searchParams.get("entry");
    if (!entry || !entry.trim() || entry.length > MAX_ENTRY_ID_LEN) {
      return NextResponse.json({ error: "entry is required" }, { status: 400 });
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
      return NextResponse.json({ error: "No interview prep to update — generate it first." }, { status: 404 });
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
    const entry = request.nextUrl.searchParams.get("entry");
    if (!entry || !entry.trim() || entry.length > MAX_ENTRY_ID_LEN) {
      return NextResponse.json({ error: "entry is required" }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as { questions?: unknown };
    const incoming = normalizeIncoming(body.questions);
    if (incoming.length === 0) {
      return NextResponse.json({ error: "questions is required" }, { status: 400 });
    }

    // Read-merge-write through the existing full-payload save path (getInterviewPrep +
    // saveInterviewPrep) — no parallel store, no new persistence function. Preserve
    // every other payload key (generated plan, userProgress, humanScorecard).
    const existing = getInterviewPrep(entry);
    if (!existing) {
      return NextResponse.json({ error: "No interview prep to import into — generate it first." }, { status: 404 });
    }
    const prior = readImported(existing.payload);
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
