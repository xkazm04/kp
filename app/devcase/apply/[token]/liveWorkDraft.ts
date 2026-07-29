// Live Work Surface — local draft persistence (verifier pass, 2026-07-17).
//
// Pure encode/decode helpers, kept free of `window`/`localStorage` so they run
// under node:test with no DOM. LiveWorkSurface.tsx is the only caller that
// actually touches `localStorage`, guarded by `typeof window !== "undefined"`.
//
// WHY THIS EXISTS: the surface already flushes to the server every FLUSH_MS and
// re-buffers a batch in memory (pendingRef) when a flush fails — but that buffer,
// and the `files` React state itself, live ONLY in memory. A reload, a crashed
// tab, or a laptop that sleeps through a flaky-wifi gap loses everything back to
// the frozen seed, even though most of the work was never actually gone — it just
// never survived a page life-cycle event. This module is the client-side durable
// copy: written on every meaningful change, read once on mount to resume.
import type { ProcessEvent, SeedFile } from "@/app/features/tools/devcases/DevTypes";

// Mirror the server's own bounds (app/api/devcase/session/[id]/route.ts) so a
// corrupted/tampered localStorage blob can't blow up the tab or smuggle an
// oversized payload into the next flush. Local storage is candidate-writable,
// so treat it exactly like other client input: parse defensively, never trust.
const MAX_FILES = 50;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_PENDING_EVENTS = 2000;
const KINDS = new Set<ProcessEvent["kind"]>(["open", "edit", "decision_log", "submit", "paste"]);

export type LiveWorkDraft = {
  sessionId: string | null;
  files: SeedFile[];
  pending: ProcessEvent[];
  savedAt: number;
};

export function draftStorageKey(token: string): string {
  return `kp:devcase:livework:${token}`;
}

export function encodeDraft(draft: LiveWorkDraft): string {
  return JSON.stringify(draft);
}

/** Defensively parse a stored draft. Returns null on anything malformed rather
 *  than throwing — a bad blob must fall back to the frozen seed, never crash
 *  the work surface. */
export function decodeDraft(raw: string | null | undefined): LiveWorkDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;

  const sessionId = typeof p.sessionId === "string" && p.sessionId ? p.sessionId : null;

  const files: SeedFile[] = Array.isArray(p.files)
    ? p.files
        .filter(
          (f): f is SeedFile =>
            !!f && typeof f === "object" && typeof (f as SeedFile).path === "string" && typeof (f as SeedFile).contents === "string"
        )
        .slice(0, MAX_FILES)
        .map((f) => ({ path: f.path, contents: f.contents.slice(0, MAX_FILE_BYTES) }))
    : [];

  const pending: ProcessEvent[] = Array.isArray(p.pending)
    ? p.pending
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
        .filter((e) => KINDS.has(String(e.kind) as ProcessEvent["kind"]))
        .slice(0, MAX_PENDING_EVENTS)
        .map((e) => {
          const ev: ProcessEvent = { t: Number(e.t) || 0, kind: String(e.kind) as ProcessEvent["kind"] };
          if (typeof e.path === "string") ev.path = e.path;
          if (Number.isFinite(Number(e.size))) ev.size = Number(e.size);
          return ev;
        })
    : [];

  const savedAt = Number.isFinite(Number(p.savedAt)) ? Number(p.savedAt) : 0;

  if (files.length === 0 && pending.length === 0 && !sessionId) return null;
  return { sessionId, files, pending, savedAt };
}
