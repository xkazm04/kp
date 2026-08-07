// Client half of the apply-funnel denominator (see apply-session-store.ts). The
// id is generated in the browser and kept in localStorage beside the draft so a
// reload, a tab restore, or a half-finished application resumed tomorrow all
// re-send the SAME id — the server upserts on it, so one candidate attempt counts
// once no matter how many times the page renders. Cleared on success, so a genuine
// re-application later is a new attempt rather than a silent overwrite.
//
// Entirely best-effort: this is measurement, and a candidate's application must
// never fail because telemetry did. Every path swallows its errors.

const KEY = (flow: string, jobId: string) => `kp:apply-session:${flow}:${jobId}`;

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Older/locked-down browsers: any bounded url-safe token satisfies the route.
    return `s-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

/** Get-or-create this attempt's session id and tell the server the candidate
 *  started. Safe to call on every mount: the id is stable per (flow, job) and the
 *  server ignores a repeat start. Returns null when localStorage is unavailable
 *  (private mode, storage disabled) — the submission then simply goes unlinked. */
export function ensureApplySession(
  jobId: string,
  flow: "chat" | "quick",
  meta?: { campaign?: string | null; variant?: string | null }
): string | null {
  try {
    const key = KEY(flow, jobId);
    const existing = window.localStorage.getItem(key);
    const id = existing || newId();
    if (!existing) window.localStorage.setItem(key, id);
    // Fire-and-forget. A repeat POST after a reload is intentional and cheap: the
    // insert is ON CONFLICT DO NOTHING, so it keeps the row that already exists.
    void fetch(`/api/apply/${jobId}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: id, flow, campaign: meta?.campaign ?? null, variant: meta?.variant ?? null }),
      keepalive: true,
    }).catch(() => {
      /* measurement must never surface to the candidate */
    });
    return id;
  } catch {
    return null;
  }
}

/** Read the current attempt's id without minting one — used when building the
 *  submit body, so a failed mint doesn't create an unstarted session. */
export function readApplySession(jobId: string, flow: "chat" | "quick"): string | null {
  try {
    return window.localStorage.getItem(KEY(flow, jobId));
  } catch {
    return null;
  }
}

/** Retire the attempt once it has been filed, so the candidate's next application
 *  to the same role counts as a new start rather than reusing a linked row. */
export function clearApplySession(jobId: string, flow: "chat" | "quick"): void {
  try {
    window.localStorage.removeItem(KEY(flow, jobId));
  } catch {
    /* nothing to clear */
  }
}
