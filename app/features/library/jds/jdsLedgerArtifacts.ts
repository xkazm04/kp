// The structured build artifacts (salary / case) + the Duplicate intent-prompt
// reader for LibrarySavedJdsLedger.tsx — extracted verbatim so that file stays
// under the 200-line split threshold.

// The structured artifacts the jd_build handler stores in jds.analysis_json — the
// same payload runJdBuild returns, minus the markdown body (that's jds.body).
export type CaseArtifact = { title?: string; brief?: string; tasks?: unknown[]; timeboxHours?: number };
export type Artifacts = {
  role?: Record<string, unknown>;
  salary?: unknown;
  salarySources?: string[];
  salarySource?: string;
  case?: CaseArtifact | null;
  options?: { description?: boolean; marketResearch?: boolean; caseDesign?: boolean };
};

export function parseArtifacts(json: string | null | undefined): Artifacts | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Artifacts;
  } catch {
    return null;
  }
}

export function hasCaseContent(kase: CaseArtifact | null | undefined): kase is CaseArtifact {
  return !!kase && (Boolean(kase.title) || Boolean(kase.brief) || (Array.isArray(kase.tasks) && kase.tasks.length > 0));
}

export function caseTaskLabel(task: unknown): string {
  if (typeof task === "string") return task;
  if (task && typeof task === "object") {
    const o = task as Record<string, unknown>;
    return String(o.title ?? o.prompt ?? o.name ?? o.description ?? "Task");
  }
  return "Task";
}

// The recruiter's original "describe the need" prompt out of a JD's persisted build
// intent (build_input_json), or "" when absent/legacy/malformed — so Duplicate can
// prefer intent over the rendered body without the caller re-parsing JSON.
export function readIntentPrompt(json: string | null | undefined): string {
  if (!json) return "";
  try {
    const intent = JSON.parse(json) as { needText?: unknown };
    return typeof intent.needText === "string" ? intent.needText.trim() : "";
  } catch {
    return "";
  }
}
