"use client";

// Per-stage aging SLA overrides (PIPE4) — the recruiter's per-board tuning of the
// STAGE_SLA_DEFAULTS, plus the editor's open/closed flag. Split out of
// usePipelineTabState so the tab hook is composition, not six concerns in one body.

import { useEffect, useState } from "react";
import { PIPELINE_SLA_KEY } from "./pipelineTabHelpers";
import { clampSlaDays } from "./pipelineSla";

export function usePipelineSla() {
  // Per-stage aging SLA overrides (PIPE4): a recruiter's per-board tuning of the
  // STAGE_SLA_DEFAULTS, persisted in localStorage (client-only, no schema).
  const [slaOverrides, setSlaOverrides] = useState<Record<string, number>>({});
  const [editingSla, setEditingSla] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIPELINE_SLA_KEY);
      // Client-only localStorage — see the saved-views hydration (usePipelineSavedViews):
      // a mount effect is the SSR-safe way to read it, and a one-time set isn't a
      // cascading-render concern.
      // Clamped on the way IN too: a value stored by an older build (which accepted
      // anything positive) must not keep silencing a column's aging chip forever.
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>;
        const clean: Record<string, number> = {};
        for (const [stage, days] of Object.entries(parsed)) {
          const c = clampSlaDays(String(days));
          if (c) clean[stage] = c;
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSlaOverrides(clean);
      }
    } catch {
      /* corrupt/absent — fall back to defaults */
    }
  }, []);
  const setStageSla = (stage: string, days: number | null) => {
    const next = { ...slaOverrides };
    // Re-clamped at the STORE, not only at the field: this is what persists, and a
    // second caller (or a hydrated value from an older build that stored 5000) must
    // not be able to write a cadence the aging chip will never fire on.
    const clamped = days == null ? null : clampSlaDays(String(days));
    if (clamped) next[stage] = clamped;
    else delete next[stage]; // cleared → back to the default
    setSlaOverrides(next);
    try {
      localStorage.setItem(PIPELINE_SLA_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — in-memory override still applies this session */
    }
  };
  return { slaOverrides, setStageSla, editingSla, setEditingSla };
}

export type PipelineSlaState = ReturnType<typeof usePipelineSla>;
