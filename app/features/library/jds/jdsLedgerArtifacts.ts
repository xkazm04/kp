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

/** One case task's display label. The AI's case designer emits either a bare
 *  string or an object under one of four field names, and neither shape is
 *  guaranteed — so the caller supplies the LOCALIZED fallback for a task that
 *  carries no readable label at all. It used to be a hardcoded English "Task",
 *  rendered verbatim to cs/de/fr recruiters in an otherwise fully localized
 *  panel, and the eslint i18n rule reads JSX text nodes so it could never see a
 *  literal arriving through this helper. */
export function caseTaskLabel(task: unknown, fallback: string): string {
  if (typeof task === "string" && task.trim()) return task;
  if (task && typeof task === "object") {
    const o = task as Record<string, unknown>;
    for (const key of ["title", "prompt", "name", "description"] as const) {
      if (typeof o[key] === "string" && (o[key] as string).trim()) return o[key] as string;
    }
  }
  return fallback;
}

// ── The persisted build intent (jds.build_input_json) ─────────────────────────
// What POST /api/jds/generate recorded BEFORE the build ran: the recruiter's raw
// prompt plus the choices that shaped the output (template, output language,
// seniority, role family, repo). Everything here is optional — a draft save and
// every pre-migration row carry no intent at all.
export type BuildIntent = {
  needText: string;
  company: string;
  seniority: string;
  roleFamily: string;
  repoUrl: string;
  lang: string;
  templateId: string;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Parse `build_input_json` into the whole intent, or null when there is none /
 *  it does not parse. Duplicate re-seeds the builder from this (so a copy is
 *  rebuilt with the SAME template and output language, not the app defaults), and
 *  the detail modal states it back so the recruiter can see what produced the JD.
 *  Every field normalizes to "" rather than undefined, so a caller can treat an
 *  absent choice and an empty one identically. */
export function readBuildIntent(json: string | null | undefined): BuildIntent | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  // An array parses as an object and would yield an all-empty intent — which the
  // detail modal would then draw as a real provenance line about a build we know
  // nothing about. Only a JSON object is an intent.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  return {
    needText: str(o.needText),
    company: str(o.company),
    seniority: str(o.seniority),
    roleFamily: str(o.roleFamily),
    repoUrl: str(o.repoUrl),
    lang: str(o.lang),
    templateId: str(o.templateId),
  };
}

// The recruiter's original "describe the need" prompt out of a JD's persisted build
// intent (build_input_json), or "" when absent/legacy/malformed — so Duplicate can
// prefer intent over the rendered body without the caller re-parsing JSON.
export function readIntentPrompt(json: string | null | undefined): string {
  return readBuildIntent(json)?.needText ?? "";
}

/** Did this build's markdown NOT become the JD's body?
 *
 *  runJdBuild's `finishJdAnalysis` takes the generated body ONLY while the row is
 *  still the untouched placeholder. An operator who edited the JD during the 1-2
 *  minute build keeps their text and the build is filed as a REVISION — the run
 *  returns `bodyHeldAsRevision: true` on its task result to say so. Nothing else
 *  records it: the row itself flips to `ready` exactly as a normal build does, so
 *  the task result is the only evidence, and this is the one reader of it.
 *  Anything that is not the literal boolean `true` reads as "not held". */
export function heldAsRevision(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  return (result as Record<string, unknown>).bodyHeldAsRevision === true;
}
