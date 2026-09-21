// Read-only voice-screen script for CaseDetail Internal, extracted as pure TS so
// the "phases exist → list them; no phases → render nothing" contract is unit-testable.
// Publish already knows whether the scenario is degraded; this is the body the
// recruiter reads before ticking "publish anyway" — intro clip + phase titles +
// spoken probes, never listen-for / red-flag notes.

export type VoiceScriptPhase = { title: string; probe: string };
export type VoiceScriptPreview = {
  intro: string;
  phases: VoiceScriptPhase[];
  degraded: boolean;
};

export type ScenarioPreviewInput = {
  phases?: unknown;
  caseIntro?: unknown;
  source?: unknown;
} | null | undefined;

function phaseFromUnknown(raw: unknown): VoiceScriptPhase | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as { phase?: unknown; probe?: unknown };
  const title = typeof rec.phase === "string" ? rec.phase.trim() : "";
  if (!title) return null;
  const probe = typeof rec.probe === "string" ? rec.probe.trim() : "";
  return { title, probe };
}

/** Null when there is no phase list to show — callers must render nothing, not
 *  an empty "Voice screen script" heading. */
export function voiceScriptPreview(scenario: ScenarioPreviewInput): VoiceScriptPreview | null {
  const rawPhases = Array.isArray(scenario?.phases) ? scenario.phases : [];
  const phases = rawPhases.map(phaseFromUnknown).filter((p): p is VoiceScriptPhase => p != null);
  if (phases.length === 0) return null;
  const intro = typeof scenario?.caseIntro === "string" ? scenario.caseIntro.trim() : "";
  const source = typeof scenario?.source === "string" ? scenario.source : null;
  return { intro, phases, degraded: source != null && source !== "llm" };
}
