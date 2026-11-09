"use client";

import { useEffect, useState } from "react";

// Is the AI voice interview on for this install? Client side of voice/enabled.ts: the
// flag is a server env var, so the browser learns it from the readiness report's
// `enabled` field (GET /api/voice/readiness, which never mints). ONE request per page
// load, shared by every surface that asks; `null` until it answers (and when it fails),
// which `voiceSurfaceVisible` reads as hidden.

let pending: Promise<boolean | null> | null = null;

function readEnabled(): Promise<boolean | null> {
  pending ??= fetch("/api/voice/readiness")
    .then((r) => (r.ok ? (r.json() as Promise<{ enabled?: unknown }>) : null))
    .then((body) => (body && typeof body.enabled === "boolean" ? body.enabled : null))
    .catch(() => null);
  return pending;
}

export function useVoiceEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void readEnabled().then((v) => {
      if (alive) setEnabled(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}
