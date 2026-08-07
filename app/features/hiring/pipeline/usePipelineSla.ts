"use client";

// Per-stage aging SLA overrides (PIPE4) — the recruiter's per-board tuning of the
// STAGE_SLA_DEFAULTS, plus the editor's open/closed flag. Split out of
// usePipelineTabState so the tab hook is composition, not six concerns in one body.

import { useEffect, useState } from "react";
import { PIPELINE_SLA_KEY } from "./pipelineTabHelpers";

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setSlaOverrides(JSON.parse(raw) as Record<string, number>);
    } catch {
      /* corrupt/absent — fall back to defaults */
    }
  }, []);
  const setStageSla = (stage: string, days: number | null) => {
    const next = { ...slaOverrides };
    if (days && days > 0) next[stage] = days;
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
