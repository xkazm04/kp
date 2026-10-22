// The first-time "open your workspace" entry on the landing (cx T2).
//
// A local install in open mode has no credential to ask for, so the landing's
// "Sign in" is really "enter". This module is the pure half: who gets the in-app
// labels, and whether a return visit skips the landing. The door itself is
// unchanged — enterWorkspace() posts to /api/auth/login, which sets kp_entered.
//
// Safe to import from client and server (no node/DB imports).

/** localStorage key: this browser has entered the workspace before. */
export const OPEN_ENTRY_MARKER = "kp_entered_once";
/** sessionStorage key: an auto-entry was already tried this tab (no reload loop
 *  when cookies are blocked). */
export const OPEN_ENTRY_TRIED = "kp_auto_enter_tried";

/** Open mode — the same predicate the auth layer uses everywhere: no operator password. */
export function isOpenMode(env: Record<string, string | undefined> = process.env): boolean {
  return !env.KP_OPERATOR_PASSWORD;
}

/** A loopback Host header (`localhost:3000`, `127.0.0.1`, `[::1]:3000`): the install
 *  is being opened on the machine that runs it, not through a public link. */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  const name = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]" || name.endsWith(".localhost");
}

/** Server decision: do the landing's sign-in calls to action become "open your workspace"? */
export function openEntryOffered(opts: { openMode: boolean; host: string | null | undefined }): boolean {
  return opts.openMode && isLoopbackHost(opts.host);
}

/** Return-visit decision, evaluated on the landing (so kp_entered is already absent):
 *  skip the landing only when the entry is offered AND this browser has the marker. */
export function returnVisitDecision(opts: { openEntry: boolean; marker: boolean }): "enter" | "stay" {
  return opts.openEntry && opts.marker ? "enter" : "stay";
}

function store(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // storage blocked (privacy mode, sandbox): behave as if unset
  }
}

export function readEntryMarker(): boolean {
  try {
    return store("local")?.getItem(OPEN_ENTRY_MARKER) === "1";
  } catch {
    return false;
  }
}

export function writeEntryMarker(): void {
  try {
    store("local")?.setItem(OPEN_ENTRY_MARKER, "1");
  } catch {
    /* best-effort: without the marker the visitor just sees the landing next time */
  }
}

/** Sign-out clears it, or the landing would bounce the visitor straight back in. */
export function clearEntryMarker(): void {
  try {
    store("local")?.removeItem(OPEN_ENTRY_MARKER);
    store("session")?.removeItem(OPEN_ENTRY_TRIED);
  } catch {
    /* best-effort: storage unavailable means there was no marker to clear */
  }
}

/** True once per tab; false if an auto-entry was already tried (or storage is gone). */
export function claimAutoEntry(): boolean {
  try {
    const s = store("session");
    if (!s || s.getItem(OPEN_ENTRY_TRIED) === "1") return false;
    s.setItem(OPEN_ENTRY_TRIED, "1");
    return true;
  } catch {
    return false;
  }
}
