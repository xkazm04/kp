import { NextResponse } from "next/server";
import { appendDevSessionEvents, getDevCase, getDevSession, getDevSessionChat, getDevSessionEvents, getDevSessionMeta, getPostingByToken, saveDevSessionFiles } from "@/app/_lib/db/devcase";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { sessionTokenMatches } from "@/app/_lib/devcase-session-auth";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { rateLimit } from "@/app/_lib/rate-limit";
// The flush byte budget lives in a sibling module: Next's generated route types
// reject any non-handler `export const` here (backlog item 57).
import { chargeFlushBytes } from "../session-limits";
import { readTextWithLimit } from "@/app/_lib/request-body";

// Per-token mid-flight-update memo (case-sim round 3 canary c2): the flush path
// fires every ~8s per active candidate, and the token→posting→case chain it used
// to walk per request resolves data that is FROZEN at publish (the seed/case
// freeze contract) — it cannot change mid-session, so one resolve per token is
// enough. Bounded FIFO so a leaked-token flood can't grow it unboundedly.
const MFU_CACHE = new Map<string, { afterMinutes: number; update: string } | null>();
const MFU_CACHE_MAX = 500;

function midFlightUpdateForToken(token: string): { afterMinutes: number; update: string } | null {
  if (MFU_CACHE.has(token)) return MFU_CACHE.get(token) ?? null;
  const kase = getDevCase(getPostingByToken(token)?.caseId ?? "")?.case as
    | { midFlightUpdate?: { afterMinutes?: number; update?: string } }
    | null;
  const mfu = kase?.midFlightUpdate;
  const resolved =
    mfu?.update && typeof mfu.afterMinutes === "number" ? { afterMinutes: mfu.afterMinutes, update: mfu.update } : null;
  if (MFU_CACHE.size >= MFU_CACHE_MAX) {
    const oldest = MFU_CACHE.keys().next().value;
    if (oldest !== undefined) MFU_CACHE.delete(oldest);
  }
  MFU_CACHE.set(token, resolved);
  return resolved;
}


export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // OPERATOR-ONLY. This route lives under the PUBLIC `/api/devcase/session` prefix
  // (its three siblings are candidate doors, each proving the apply token), but
  // the read is the recruiter's: it returns the candidate's whole transcript and
  // file tree. The workspace comparison below is a TENANT check, not an auth
  // check - `currentWorkspace()` resolves to the default workspace for an
  // anonymous caller - and session ids are Math.random ids, never a boundary.
  // Without this gate an anonymous caller on a default-workspace deployment
  // could enumerate ids and read candidate work. Open dev mode is unaffected
  // (the gate is a no-op there), which is what the ownership test relies on.
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const session = getDevSession(id);
    if (!session) return jsonRefusal("DEVCASE_SESSION_NOT_FOUND", 404);

    const callerWorkspace = await currentWorkspace();
    if (session.workspaceId !== callerWorkspace) {
      return jsonRefusal("DEVCASE_SESSION_NOT_FOUND", 404);
    }

    const transcript = getDevSessionChat(id);

    return NextResponse.json({
      session: {
        id: session.id,
        status: session.status,
        candidateRef: session.candidateRef,
        createdAt: session.createdAt,
        submittedAt: session.submittedAt,
      },
      transcript,
      files: session.files,
    });
  } catch (error) {
    // Operator-facing, but on better-sqlite3: the thrown message carries SQLITE_*
    // codes and the absolute db path. Log it, answer the code.
    return safeJsonError(error, "api:devcase/session/read", "DEVCASE_SESSION_READ_FAILED");
  }
}

// Live Work Surface (moonshot E) — append observed events + save the (editable)
// seed tree for an active session. Hand-rolled boundary coercion + bounds (the
// payload is candidate-controlled): drop unknown event kinds, cap counts/size.
// "paste" carries the paste MAGNITUDE (`size`, char count) — the in-product
// bulk-paste authenticity tell (devcase-authenticity PASTE_BULK_CHARS). Bug-ui-scan
// 2026-07-09 #1: it was previously OMITTED from this allow-list (and `size` dropped
// by the map/DB), so the -65 anti-ghostwriting penalty could never fire.
const KINDS = new Set(["open", "edit", "decision_log", "submit", "paste"]);
const MAX_EVENTS = 500; // per flush
const MAX_FILES = 50;
const MAX_FILE_BYTES = 256 * 1024;
/** Hard cap on this public door's request body, enforced on the BYTES READ rather
 *  than on the caller's content-length: MAX_FILES x MAX_FILE_BYTES = 12.8 MB of file
 *  contents, plus room for the JSON envelope and its escaping. */
const MAX_FLUSH_BODY_BYTES = 16 * 1024 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Status-only read (case-sim round 3): this hot path never needs the files
    // blob getDevSession would parse on every flush.
    const session = getDevSessionMeta(id);
    // Codes, not English: the flush is a candidate door, and the surface reads the
    // 404/409 as "this session id is dead, mint a fresh one" either way.
    if (!session) return jsonRefusal("DEVCASE_SESSION_NOT_FOUND", 404);
    if (session.status !== "active") return jsonRefusal("DEVCASE_SESSION_ALREADY_SUBMITTED", 409);

    // Read the body as TEXT first: its byte length is what the per-token daily budget
    // charges, and JSON.parse of the same string costs nothing extra.
    //
    // UNDER A HARD CAP, aborting the stream rather than buffering: this is the read
    // the byte budget below was written for, and until it had one the budget could
    // only charge for a flush that had ALREADY been buffered whole. An unauthenticated
    // caller holding an apply link could hand this route a gigabyte and the process
    // paid for it before a single limiter ran. 16 MB is the route's own admitted
    // maximum (MAX_FILES 50 x MAX_FILE_BYTES 256 KB = 12.8 MB of file contents) plus
    // room for the JSON envelope and its escaping, so no legitimate flush meets it.
    const raw = await readTextWithLimit(request, MAX_FLUSH_BODY_BYTES);
    if (raw === null) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_FLUSH_BODY_BYTES });
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // A malformed body is treated as an empty one, exactly as the previous
      // `request.json().catch(() => ({}))` did — the coercion below drops it anyway,
      // and a candidate mid-assessment must not see a parse error for a flaky flush.
      parsed = {};
    }
    const body = (parsed ?? {}) as { events?: unknown; files?: unknown; token?: unknown };
    // A session id alone is not authority to append to this session's observed process log
    // or to OVERWRITE its file tree — that second one destroys another candidate's work.
    // The caller must present the apply token that minted the session
    // (devcase-session-auth.ts). 403, deliberately not 404/409: those tell the client the
    // session is dead and to re-mint, which would spin the per-token/day session quota.
    //
    // A TOKENLESS session (fixtures/dev seeds; the public mint always carries one) used to
    // take a `session.token && …` carve-out and walk STRAIGHT PAST this gate and past both
    // budgets below — a session id was full authority over it. The submit sibling already
    // refused those outright; the flush now agrees, so there is one rule on all three
    // mutating doors and no row shape that is exempt from the throttle.
    if (!session.token || !sessionTokenMatches(session.token, body.token)) {
      return jsonRefusal("SESSION_TOKEN_REQUIRED", 403);
    }

    // THROTTLE (rate-limit-contract.test.ts) — the same two-window shape the chat sibling
    // carries, and for the same reason: this is a PUBLIC route that appends rows and
    // OVERWRITES a file tree, admitting 50 x 256 KB = 12.8 MB per call, and it carried no
    // bound at all. Budgets and their arithmetic: ../session-limits.ts. Both windows run
    // AFTER the 404/409/403 refusals (a rejected call never consumes budget) and BEFORE
    // the first write.
    if (!rateLimit(`devcase-flush:${id}`, { limit: 200, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    if (!rateLimit(`devcase-flush-token:${session.token}`, { limit: 60_000, windowMs: 24 * 60 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // …and the bound the two counts cannot express: BYTES per apply token per day.
    if (!chargeFlushBytes(session.token, raw.length)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    let seq = 0;
    if (Array.isArray(body.events)) {
      const events = body.events
        .slice(0, MAX_EVENTS)
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
        .filter((e) => KINDS.has(String(e.kind)))
        .map((e) => ({
          t: Number(e.t) || 0,
          kind: String(e.kind),
          path: typeof e.path === "string" ? e.path : null,
          // Carry the paste MAGNITUDE (char count) through to the DB so the observed
          // bulk-paste authenticity penalty can fire. Candidate-controlled, so coerce
          // to a finite number (never the raw shape); null for non-paste kinds.
          size: Number.isFinite(Number(e.size)) ? Number(e.size) : null,
        }));
      seq = appendDevSessionEvents(id, events);
    }

    if (Array.isArray(body.files)) {
      const files = body.files
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && typeof f.path === "string")
        .slice(0, MAX_FILES)
        .map((f) => ({ path: String(f.path), contents: String(f.contents ?? "").slice(0, MAX_FILE_BYTES) }));
      saveDevSessionFiles(id, files);
    }

    // Mid-flight update reveal (LLM-era controls #5): once the session is older than
    // the case's afterMinutes, serve the requirement change with this flush response
    // and record the reveal SERVER-SIDE as a chained "perturbation" event (clients
    // can't submit that kind — see KINDS above — so the reveal moment is trustworthy).
    // Already-fired sessions keep receiving the text so a reload re-renders the banner.
    // The clock the candidate could not see. The brief says "2h" and then the surface
    // never showed elapsed time, so the only person who knew how long they had been
    // working was the one least able to judge it. Server truth (the session's own
    // createdAt), carried on the flush the surface already makes every 8s, so a reload
    // or a second device cannot restart it. Advisory: nothing here refuses anything.
    const startedAt = Date.parse(session.createdAt);
    const elapsedMinutes = Number.isFinite(startedAt) ? Math.max(0, Math.round((Date.now() - startedAt) / 60_000)) : null;

    let perturbation: string | null = null;
    const mfu = session.token ? midFlightUpdateForToken(session.token) : null;
    if (mfu) {
      const fired = getDevSessionEvents(id).some((e) => e.kind === "perturbation");
      const due = Date.now() - Date.parse(session.createdAt) >= mfu.afterMinutes * 60_000;
      if (fired || due) {
        if (!fired) appendDevSessionEvents(id, [{ t: Date.now(), kind: "perturbation", path: null }]);
        perturbation = mfu.update;
      }
    }

    return NextResponse.json({ ok: true, seq, perturbation, elapsedMinutes });
  } catch (error) {
    // A PUBLIC candidate door: never the store's own message. The surface keeps the
    // batch buffered and the draft on the device, so this reads as "not saved yet".
    return safeJsonError(error, "api:devcase/session/flush", "DEVCASE_SESSION_FLUSH_FAILED");
  }
}
