import { NextResponse } from "next/server";
import { appendDevSessionEvents, getDevCase, getDevSession, getDevSessionChat, getDevSessionEvents, getDevSessionMeta, getPostingByToken, saveDevSessionFiles } from "@/app/_lib/db/devcase";
import { jsonError, jsonRefusal } from "@/app/_lib/api-response";
import { sessionTokenMatches } from "@/app/_lib/devcase-session-auth";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";

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
  try {
    const { id } = await params;
    const session = getDevSession(id);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

    const callerWorkspace = await currentWorkspace();
    if (session.workspaceId !== callerWorkspace) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
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
    return jsonError(error, "Failed to read session.");
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Status-only read (case-sim round 3): this hot path never needs the files
    // blob getDevSession would parse on every flush.
    const session = getDevSessionMeta(id);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    if (session.status !== "active") return NextResponse.json({ error: "session already submitted" }, { status: 409 });

    const body = (await request.json().catch(() => ({}))) as { events?: unknown; files?: unknown; token?: unknown };
    // A session id alone is not authority to append to this session's observed process log
    // or to OVERWRITE its file tree — that second one destroys another candidate's work.
    // The caller must present the apply token that minted the session
    // (devcase-session-auth.ts). 403, deliberately not 404/409: those tell the client the
    // session is dead and to re-mint, which would spin the per-token/day session quota.
    if (session.token && !sessionTokenMatches(session.token, body.token)) {
      return jsonRefusal("SESSION_TOKEN_REQUIRED", 403);
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

    return NextResponse.json({ ok: true, seq, perturbation });
  } catch (error) {
    return jsonError(error, "Failed to save the work session.");
  }
}
