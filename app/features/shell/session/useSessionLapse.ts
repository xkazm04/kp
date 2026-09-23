"use client";

// Wiring for the session-lapse contract (sessionLapse.ts owns every decision).
//
//   • Learns the caller's own session facts from GET /api/me/capabilities — riding
//     useCapabilities' in-flight read on mount (sharedGet coalesces them).
//   • Arms ONE timer at the next moment the phase can change (T-10 min, then each
//     minute, then expiry). A due expiry re-reads the server before prompting, so a
//     re-sign-in in another tab is adopted rather than nagged about.
//   • Re-checks on return to the tab (a laptop lid pauses timers).
//   • Takes 401s from the shell's attention poll (useAttention -> reportSessionStatus):
//     an epoch kill-switch bump or a revoked cookie shows up within one poll.
//
// Nothing here extends a session. The dialog POSTs to the real login door, and only
// then does afterSignIn() decide: resume in place, switch back to the lapsed team
// through the membership-checked switch door, or reload '/' when a different person
// signed in (their page state must not be inherited). Unsaved form state survives
// only because the page is never unmounted — nothing is persisted server-side.

import { useCallback, useEffect, useRef, useState } from "react";
import { httpStatusOf, sharedGetJson } from "@/app/features/shared/sharedGet";
import { notifyDataChanged } from "../live-refresh";
import {
  lapseOnStatus,
  parseSessionFacts,
  phaseAt,
  reconcileRead,
  resolveReauth,
  resolveSwitch,
  type Phase,
  type SessionFacts,
  type SessionRead,
} from "./sessionLapse";

// ---- 401 intake (module scope: the attention poll has no handle on the dialog) ----
const unauthorizedListeners = new Set<() => void>();

/** Report a status the shell observed on one of its own reads. Only a 401 counts
 *  (lapseOnStatus); anything else is ignored here. */
export function reportSessionStatus(status: number | null): void {
  if (status == null || lapseOnStatus("live", status) !== "lapsed") return;
  for (const listener of unauthorizedListeners) listener();
}

async function readSession(opts: { shared: boolean }): Promise<SessionRead> {
  try {
    const body = await sharedGetJson<{ session?: unknown }>("/api/me/capabilities", { refresh: !opts.shared });
    return { status: 200, session: parseSessionFacts(body?.session) };
  } catch (err) {
    return { status: httpStatusOf(err) ?? 0 };
  }
}

/** A clock-due expiry that the server contradicts (clock skew) re-reads at most
 *  this often, instead of in a tight loop. */
const RECHECK_GRACE_MS = 60_000;

export type SessionLapse = {
  /** What the shell shows. An expiry the server has not yet confirmed reads as
   *  "expiring, 0 minutes" until the re-read answers. */
  phase: Phase;
  /** The session being watched (for a lapse: the one that lapsed). */
  session: SessionFacts | null;
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  /** Call after the login door answered 2xx. Resumes, switches back, or reloads. */
  afterSignIn: () => Promise<"resume" | "reload">;
};

// A HARD navigation on purpose (the leaveWorkspace() idiom in auth/session-nav.ts):
// a client-side push would keep every mounted component's state, and the point of a
// reload is that the page state belonged to someone else.
function goHome(): "reload" {
  window.location.assign("/");
  return "reload";
}

export function useSessionLapse(): SessionLapse {
  const [session, setSession] = useState<SessionFacts | null>(null);
  const [lapsed, setLapsed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The source of truth for callbacks (timers, the 401 listener); state mirrors it
  // for rendering. Written only in handlers, never during render.
  const armed = useRef<SessionFacts | null>(null);
  const graceUntil = useRef(0);

  const adopt = useCallback((next: SessionFacts | null) => {
    armed.current = next;
    setSession(next);
    setNow(Date.now());
  }, []);

  const markLapsed = useCallback(() => {
    if (!armed.current) return; // open mode / nothing watched: never a lapse
    setLapsed(true);
    setDialogOpen(true);
  }, []);

  const apply = useCallback(
    (read: SessionRead) => {
      const r = reconcileRead(armed.current, read);
      if (r.lapsed) markLapsed();
      else adopt(r.session);
    },
    [adopt, markLapsed],
  );

  // Mount: ride useCapabilities' in-flight read.
  useEffect(() => {
    let live = true;
    void readSession({ shared: true }).then((read) => {
      if (live) apply(read);
    });
    return () => {
      live = false;
    };
  }, [apply]);

  // 401s from the shell's own poll.
  useEffect(() => {
    unauthorizedListeners.add(markLapsed);
    return () => {
      unauthorizedListeners.delete(markLapsed);
    };
  }, [markLapsed]);

  // Return to the tab: re-read (timers do not run while a laptop sleeps).
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || !armed.current) return;
      void readSession({ shared: false }).then(apply);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [apply]);

  const clock = phaseAt({ passwordMode: session !== null, session }, now);

  // The one timer.
  useEffect(() => {
    if (lapsed || !session) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (clock.phase === "lapsed") {
      // Due by the local clock: let the server confirm before prompting.
      const wait = graceUntil.current - Date.now();
      if (wait > 0) {
        timer = setTimeout(() => setNow(Date.now()), wait);
      } else {
        graceUntil.current = Date.now() + RECHECK_GRACE_MS;
        void readSession({ shared: false }).then((read) => {
          apply(read);
          setNow(Date.now());
        });
      }
    } else if (clock.nextCheckAt != null) {
      timer = setTimeout(() => setNow(Date.now()), Math.max(0, clock.nextCheckAt - Date.now()));
    }
    return () => clearTimeout(timer);
  }, [lapsed, session, clock.phase, clock.nextCheckAt, apply]);

  const afterSignIn = useCallback(async (): Promise<"resume" | "reload"> => {
    const before = armed.current;
    if (!before) return goHome();
    const read = await readSession({ shared: false });
    let fresh = read.status === 200 ? (read.session ?? null) : null;
    const decision = resolveReauth(before, fresh);
    if (decision.action === "reload") return goHome();
    if (decision.action === "switch") {
      let status = 0;
      try {
        const res = await fetch("/api/auth/switch-workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: decision.workspaceId }),
        });
        status = res.status;
      } catch {
        status = 0; // network drop: the team could not be confirmed, so do not resume on it
      }
      if (resolveSwitch(status) === "reload") return goHome();
      const again = await readSession({ shared: false });
      fresh = again.status === 200 ? (again.session ?? null) : null;
      if (resolveReauth(before, fresh).action !== "resume") return goHome();
    }
    adopt(fresh);
    setLapsed(false);
    setDialogOpen(false);
    // One refresh for every view: whatever a 401 left stale re-reads now.
    notifyDataChanged();
    return "resume";
  }, [adopt]);

  const phase: Phase = lapsed
    ? { phase: "lapsed", nextCheckAt: null }
    : clock.phase === "lapsed"
      ? { phase: "expiring", minutesLeft: 0, nextCheckAt: now }
      : clock;

  return {
    phase,
    session,
    dialogOpen,
    openDialog: useCallback(() => setDialogOpen(true), []),
    closeDialog: useCallback(() => setDialogOpen(false), []),
    afterSignIn,
  };
}
