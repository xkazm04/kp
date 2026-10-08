import { insertAnalyzingJd, markJdAnalyzing, setJdAnalysisTask, type JdBuildIntent } from "./db/jobs";
import { startTask } from "./tasks";
import { type JdBuildOptions } from "./jd-build-run";

// THE ONE DOOR into a backgrounded `jd_build`.
//
// Starting a build is a three-step contract that must not drift between callers:
//   1. insert the placeholder JD row so it appears in the Ledger as "Analyzing"
//      immediately (and, on a retry, reset the existing row instead);
//   2. start the detached task, stamped with the SAME workspace as the row — a
//      mismatch files the build's matchable `jd-<slug>` opening into another
//      team's corpus, so the team that ran the build never finds their opening;
//   3. link row → task so the Ledger can show live progress and offer a retry.
//
// Four doors used to hand-roll those three steps: POST /api/jds/generate,
// POST /api/jds/[slug]/retry-analysis, the companion's `draft_jd` action and
// POST /api/intake/[id]/promote. Four copies of a spend-bearing sequence is how a
// rule lands on three of them — which is exactly what happened with the tenant
// stamp, and what the throttles would have repeated. `jd-build-start.test.ts`
// forbids a fifth copy at the source.

/** What every door supplies. `params` is the task payload minus the parts this
 *  seam owns (`title`, `jdSlug`, `options`), so a caller cannot start a build whose
 *  task is stamped for a different row or a different checklist than the row it
 *  just created. */
export type StartJdBuildInput = {
  title: string;
  options: JdBuildOptions;
  /** Persisted on the JD row (build_input_json) so Duplicate re-seeds the PROMPT
   *  and Retry can replay after the task row is pruned. */
  buildInput: JdBuildIntent;
  params: Record<string, unknown>;
  workspaceId?: string;
  /** The authoring user id, stamped on the placeholder row (`jds.created_by`) so
   *  the Ledger's delete door can tell the creator from a colleague. Resolve it in
   *  the DOOR — `(await currentUser()).userId` — because this seam is synchronous
   *  and cannot read the session itself. Omitted/null means "no creator claim": the
   *  JD is then deletable only by an owner/admin, which is the fail-closed
   *  direction, and the correct value in open dev and for an operator-password
   *  session (both of which resolve as admin anyway). */
  createdBy?: string | null;
};

/** Create the placeholder JD and start its build. Returns the minted slug + task id. */
export function startJdBuild(input: StartJdBuildInput): { slug: string; taskId: string } {
  const { slug } = insertAnalyzingJd(
    { title: input.title, options: input.options, buildInput: input.buildInput },
    input.workspaceId,
    input.createdBy ?? null
  );
  const task = startTask(
    "jd_build",
    { ...input.params, title: input.title, jdSlug: slug, options: input.options },
    input.workspaceId
  );
  setJdAnalysisTask(slug, task.id);
  return { slug, taskId: task.id };
}

/** Reconstruct the jd_build params from the JD row's persisted intent — the
 *  row-fallback replay path when the original task record has been pruned. Mirrors
 *  the shape POST /api/jds/generate hands the seam, re-resolving templateBody from
 *  the stored templateId (which is durable; the resolved body isn't) through the
 *  caller's workspace-scoped `resolveTemplateBody`. The promoted
 *  intake `brief` rides along when the intent carries one (a plain object only;
 *  legacy intents have none and replay without the key). NULL/blank intent ⇒ null
 *  (a legacy row with neither task nor intent → the route's 400). */
export function replayParamsFromIntent(
  title: string,
  raw: string | null | undefined,
  resolveTemplateBody: (templateId: string) => string | undefined
): Record<string, unknown> | null {
  if (!raw) return null;
  let intent: JdBuildIntent;
  try {
    intent = JSON.parse(raw) as JdBuildIntent;
  } catch {
    return null;
  }
  // The caller supplies the resolver so the template is read in the JD's OWN
  // workspace (tenancy): getTemplate has a defaulted workspaceId, so an unscoped
  // call replayed against the DEFAULT team's templates. The route binds it to `ws`
  // (template-tenancy.test.ts pins that at the route's source).
  const templateBody =
    typeof intent.templateId === "string" && intent.templateId ? resolveTemplateBody(intent.templateId) : undefined;
  const brief: unknown = intent.brief;
  const hasBrief = typeof brief === "object" && brief !== null && !Array.isArray(brief);
  return {
    title,
    company: intent.company,
    seniority: intent.seniority,
    roleFamily: intent.roleFamily,
    needText: intent.needText,
    repoUrl: intent.repoUrl,
    lang: intent.lang,
    templateBody,
    options: intent.options,
    ...(hasBrief ? { brief } : {}),
  };
}

/** Replay a build into an EXISTING row (the Ledger's retry). The row is reset to
 *  'analyzing' first so the Ledger reflects the re-run before the replayed build
 *  lands, and `jdSlug` is forced even for legacy params so the replay re-fills THIS
 *  row rather than minting a second one. */
export function restartJdBuild(
  slug: string,
  params: Record<string, unknown>,
  workspaceId?: string
): { taskId: string } {
  markJdAnalyzing(slug);
  const task = startTask("jd_build", { ...params, jdSlug: slug }, workspaceId);
  setJdAnalysisTask(slug, task.id);
  return { taskId: task.id };
}
