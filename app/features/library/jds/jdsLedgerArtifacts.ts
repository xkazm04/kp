// The structured build artifacts (salary / case) + the Duplicate intent-prompt
// reader for LibrarySavedJdsLedger.tsx — extracted verbatim so that file stays
// under the 200-line split threshold.

// The structured artifacts the jd_build handler stores in jds.analysis_json — the
// same payload runJdBuild returns, minus the markdown body (that's jds.body).
export type CaseArtifact = { title?: string; brief?: string; tasks?: unknown[]; timeboxHours?: number };
/** The repo the build actually read, when the recruiter supplied one: the resolved
 *  ref plus what the scan found. runJdBuild has persisted this since the repo-grounding
 *  path shipped and nothing read it — so a JD grounded in a real codebase looked
 *  identical to one written from a paragraph of prose. It is provenance, and the
 *  recruiter is the person who needs it. */
export type SnapshotArtifact = {
  ref?: string;
  languages?: string[];
  inferredStack?: string[];
  loc?: number;
};

export type Artifacts = {
  role?: Record<string, unknown>;
  salary?: unknown;
  salarySources?: string[];
  salarySource?: string;
  snapshot?: SnapshotArtifact | null;
  case?: CaseArtifact | null;
  options?: { description?: boolean; marketResearch?: boolean; caseDesign?: boolean };
};

/** Whether a stored snapshot carries anything worth drawing. A build with no repoUrl
 *  persists `null`; a scan that found nothing persists an empty shell. */
export function hasRepoGrounding(snapshot: SnapshotArtifact | null | undefined): snapshot is SnapshotArtifact {
  if (!snapshot) return false;
  return Boolean(
    snapshot.ref || snapshot.loc || snapshot.languages?.length || snapshot.inferredStack?.length
  );
}

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
