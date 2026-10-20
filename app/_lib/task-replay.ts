// The whole-run REPLAY VERDICT of a finished task — one decision, read by both sides.
//
// The Background-tasks table used to offer Retry on every failed / interrupted /
// canceled row, and POST /api/tasks/[id]/retry decided only after the click whether
// the replay could run. For a failed CV analysis it never could: /api/analyze persists
// the upload into a temp workdir and passes `baseDir` + `variants[].cvPath` in the
// params, and runAnalyze `rm -rf`s that workdir in a `finally` — on failure and cancel
// too. So the button's only possible answer was 409 TASK_REPLAY_INPUTS_GONE.
//
// Now the list routes (GET /api/tasks, GET /api/tasks/history) stamp this verdict on
// every row, and the retry route refuses through `replayBlock` — the same function —
// so the row and the refusal cannot disagree. The verdict also asks the SEAT the
// retry door asks (task-admission.ts), so a caller who would be answered 403 is not
// offered the button either, and it accepts exactly the statuses `retryDecision`
// accepts for a whole-run replay (task-fanout.ts). Scoped retry of a fan-out run is
// still retryScopes' decision and is not modelled here.
//
// An existence CHECK, never a ban on the kind: a crash leaves the row 'interrupted'
// with its workdir still on disk, and that replay is genuinely valid.
//
// Pure: `exists` and the capability check are injected, so the client-safe types and
// node:test both load this without node:fs or the session layer.
import type { Capability } from "./auth/roles";
import { taskKindCapability } from "./task-admission";
import { FULL_REPLAY_STATUSES } from "./task-fanout";
import { isTaskKind } from "./task-kinds";

/** Why a dead row cannot be replayed. A CODE — the client resolves the sentence. */
export type ReplayBlockReason = "inputs-gone" | "kind-retired" | "no-seat";

export type ReplayVerdict = { replayable: true } | { replayable: false; reason: ReplayBlockReason };

/** The kinds whose params name files on the server rather than carrying their inputs
 *  inline or by DB key. A future path-bearing kind is declared here, once. */
const PATH_BEARING_KINDS: ReadonlySet<string> = new Set(["analyze"]);

export function isPathBearingKind(kind: string): boolean {
  return PATH_BEARING_KINDS.has(kind);
}

/** The server paths a stored row's params point at (analyze: baseDir + each cvPath). */
export function replayInputPaths(kind: string, params: unknown): string[] {
  if (!isPathBearingKind(kind) || !params || typeof params !== "object") return [];
  const p = params as Record<string, unknown>;
  const paths: string[] = [];
  if (typeof p.baseDir === "string" && p.baseDir) paths.push(p.baseDir);
  const variants = Array.isArray(p.variants) ? p.variants : [];
  for (const variant of variants) {
    const cvPath = (variant as { cvPath?: unknown } | null)?.cvPath;
    if (typeof cvPath === "string" && cvPath) paths.push(cvPath);
  }
  return paths;
}

/** The status-agnostic half: can this kind's stored params run again at all?
 *  The retry route calls this for every accepted decision (whole-run or scoped). */
export function replayBlock(kind: string, params: unknown, exists: (p: string) => boolean): ReplayBlockReason | null {
  if (!isTaskKind(kind)) return "kind-retired";
  const paths = replayInputPaths(kind, params);
  // Unrecognisable params (an old or hand-written row) carry no claim either way —
  // let the replay proceed rather than refusing on a guess.
  return paths.length > 0 && paths.some((p) => !exists(p)) ? "inputs-gone" : null;
}

/** The whole-run replay verdict of one row. `null` = no whole-run retry is offered at
 *  all (a success or a live run). `hasCapability` omitted = the seat is not weighed. */
export function replayVerdict(
  kind: string,
  status: string,
  params: unknown,
  exists: (p: string) => boolean,
  hasCapability?: (cap: Capability) => boolean
): ReplayVerdict | null {
  if (!FULL_REPLAY_STATUSES.has(status)) return null;
  // The retry door asks the seat first, so the verdict does too.
  if (hasCapability && !hasCapability(taskKindCapability(kind))) return { replayable: false, reason: "no-seat" };
  const reason = replayBlock(kind, params, exists);
  return reason ? { replayable: false, reason } : { replayable: true };
}

type ListRow = { id: string; kind: string; status: string };

/** Stamp `replay` on a page of list rows (whose params were projected out). ONE
 *  params read for the page's dead rows of path-bearing kinds — never a getTask per
 *  row per 2 s poll — and none at all when no row needs one. */
export function attachReplayVerdicts<T extends ListRow>(
  rows: readonly T[],
  deps: {
    loadParams: (ids: string[]) => Map<string, unknown>;
    exists: (p: string) => boolean;
    hasCapability: (cap: Capability) => boolean;
  }
): (T & { replay: ReplayVerdict | null })[] {
  const need = rows.filter((r) => FULL_REPLAY_STATUSES.has(r.status) && isPathBearingKind(r.kind)).map((r) => r.id);
  const params = need.length > 0 ? deps.loadParams(need) : new Map<string, unknown>();
  return rows.map((r) => ({
    ...r,
    replay: replayVerdict(r.kind, r.status, params.get(r.id) ?? null, deps.exists, deps.hasCapability),
  }));
}
