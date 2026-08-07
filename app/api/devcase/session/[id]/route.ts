import { NextResponse } from "next/server";
import { appendDevSessionEvents, getDevSession, saveDevSessionFiles } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";


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
    const session = getDevSession(id);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    if (session.status !== "active") return NextResponse.json({ error: "session already submitted" }, { status: 409 });

    const body = (await request.json().catch(() => ({}))) as { events?: unknown; files?: unknown };

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

    return NextResponse.json({ ok: true, seq });
  } catch (error) {
    return jsonError(error, "Failed to save the work session.");
  }
}
