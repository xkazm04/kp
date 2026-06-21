"use client";

import { useSyncExternalStore } from "react";

/*
 * Dev sign-in gate — the lightweight, localStorage-backed auth used to flip the
 * homepage between the public landing and the workspace dashboard while there is
 * no real session in development.
 *
 * Deliberately dev-only: in production this gate is disabled (useDevAuth →
 * always authed) so the dashboard keeps rendering at '/', leaving the real
 * cookie-based sign-in (/login → /api/auth/login) in charge. The pre-paint
 * theme bootstrap in app/layout.tsx hardcodes the same DEV_AUTH_KEY string —
 * keep the two in lockstep.
 */
export const DEV_AUTH_KEY = "kp_dev_authed";

/** A same-tab nudge so subscribers update without a real `storage` event
 * (which only fires in *other* tabs). */
const DEV_AUTH_EVENT = "kp:dev-auth";

/** The gate only exists in development; production renders the dashboard. */
export const DEV_GATE = process.env.NODE_ENV !== "production";

export function isDevAuthed(): boolean {
  if (!DEV_GATE) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEV_AUTH_KEY) === "1";
  } catch {
    return false;
  }
}

function setDevAuthed(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(DEV_AUTH_KEY, "1");
    else window.localStorage.removeItem(DEV_AUTH_KEY);
  } catch {
    /* private-mode / disabled storage — nothing we can do, the gate just no-ops */
  }
  window.dispatchEvent(new Event(DEV_AUTH_EVENT));
}

/* Sign-in / sign-out both hard-navigate to '/' rather than client-swapping, so
 * the pre-paint theme script re-runs with the new authed state (a guest's
 * landing stays light; the dashboard re-applies the stored dark theme). */
export function signInDev(): void {
  setDevAuthed(true);
  window.location.assign("/");
}

export function signOutDev(): void {
  setDevAuthed(false);
  window.location.assign("/");
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(DEV_AUTH_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DEV_AUTH_EVENT, onChange);
  };
}

const getSnapshot = (): boolean => isDevAuthed();
// `null` = "not yet known" (server render + first hydration frame). In
// production the gate is off, so the answer is known up front: authed.
const getServerSnapshot = (): boolean | null => (DEV_GATE ? null : true);

/** Returns `true`/`false` once known on the client, or `null` for the brief
 * pre-mount frame in development (lets the caller show a neutral splash and
 * avoid flashing the wrong surface). */
export function useDevAuth(): boolean | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
