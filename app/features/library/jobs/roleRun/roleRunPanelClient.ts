import type { RoleRunGateBatch, RoleRunView } from "@/app/api/role-runs/[id]/view";

// The job-page role-run panel's wire half: plain functions over an injected `fetch`, so the
// whole walk (start -> preview -> commit one batch per gate -> advance) is testable against the
// real route handlers without a DOM. The component is only a skin over these.
//
// The gate commit already CONTINUES the run (commitRoleRunStageGateAndContinue), so a
// recruiter's click on a gate is the only click: nothing here calls advance after a commit.
// `advanceRoleRun` exists for the one case that needs it - resuming a run parked on its LLM budget.
//
// Errors are CODES. A refused call returns the server's registered `code` (and, for the five
// approval refusals, the machine-readable `reason`); the component resolves the words through
// `errors.<CODE>` in the reader's language. The server's message is never read here.

export type PanelFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type PanelRefusal = { code: string; reason?: string };
export type PanelResult<T> = { ok: true; value: T } | { ok: false; refusal: PanelRefusal };

async function refusalOf(res: Response): Promise<PanelRefusal> {
  const body = (await res.json().catch(() => null)) as { code?: unknown; reason?: unknown } | null;
  return {
    code: typeof body?.code === "string" && body.code ? body.code : "ROLE_RUN_ADVANCE_FAILED",
    ...(typeof body?.reason === "string" ? { reason: body.reason } : {}),
  };
}

async function call<T>(fetchFn: PanelFetch, url: string, init?: RequestInit): Promise<PanelResult<T>> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch {
    // best-effort: a transport failure is reported as a code, never as the thrown message
    return { ok: false, refusal: { code: "ROLE_RUN_ADVANCE_FAILED" } };
  }
  if (!res.ok) return { ok: false, refusal: await refusalOf(res) };
  return { ok: true, value: (await res.json()) as T };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** The run this role already has (newest first), or null when none was started. Takes no pass. */
export async function loadRoleRunForJob(fetchFn: PanelFetch, jobId: string): Promise<PanelResult<RoleRunView | null>> {
  const list = await call<{ runs: { id: string }[] }>(fetchFn, `/api/role-runs?jobId=${encodeURIComponent(jobId)}`);
  if (!list.ok) return list;
  const first = list.value.runs[0];
  return first ? loadRoleRun(fetchFn, first.id) : { ok: true, value: null };
}

export function loadRoleRun(fetchFn: PanelFetch, runId: string): Promise<PanelResult<RoleRunView>> {
  return call<RoleRunView>(fetchFn, `/api/role-runs/${encodeURIComponent(runId)}`);
}

/** Start (or resume) the role's run: the existing POST, which takes the first live pass. */
export async function startRoleRun(fetchFn: PanelFetch, jobId: string): Promise<PanelResult<RoleRunView>> {
  const started = await call<{ runId: string }>(fetchFn, "/api/role-runs", json({ jobId }));
  return started.ok ? loadRoleRun(fetchFn, started.value.runId) : started;
}

export async function advanceRoleRun(fetchFn: PanelFetch, runId: string): Promise<PanelResult<RoleRunView>> {
  const advanced = await call<unknown>(fetchFn, `/api/role-runs/${encodeURIComponent(runId)}/advance`, json({}));
  return advanced.ok ? loadRoleRun(fetchFn, runId) : advanced;
}

export type BatchOutcome = {
  /** Branches whose decision was recorded before the batch stopped. */
  committed: string[];
  /** The first refusal, if the batch stopped on one; the branches after it were not tried. */
  refusal: PanelRefusal | null;
};

/**
 * Resolve every parked branch of one gate as ONE batch: preview each branch (the server derives
 * its subject set and signs it), commit it with that token, move to the next. The approver is
 * the server's - nothing here names one. A refusal (the named-approver one included, as its
 * code) stops the batch and is returned; what was committed before it stands.
 */
export async function commitGateBatch(
  fetchFn: PanelFetch,
  runId: string,
  batch: Pick<RoleRunGateBatch, "gate" | "branchRefs">,
  decision: "approved" | "declined"
): Promise<BatchOutcome> {
  const committed: string[] = [];
  const base = `/api/role-runs/${encodeURIComponent(runId)}/gate`;
  for (const branchRef of batch.branchRefs) {
    const preview = await call<{ token: string }>(fetchFn, `${base}/preview`, json({ gate: batch.gate, branchRef }));
    if (!preview.ok) return { committed, refusal: preview.refusal };
    const commit = await call<unknown>(
      fetchFn,
      `${base}/commit`,
      json({ gate: batch.gate, branchRef, decision, approvalToken: preview.value.token })
    );
    if (!commit.ok) return { committed, refusal: commit.refusal };
    committed.push(branchRef);
  }
  return { committed, refusal: null };
}

export type BatchPreview = { branchRef: string; subjectRefs: string[]; policyVersion: string; expiresAt: number };

/** What approving this gate's batch would sign: one read-only preview per parked branch. Writes
 *  nothing and spends nothing; a branch that stopped being parked reads as the refusal. */
export async function previewGateBatch(
  fetchFn: PanelFetch,
  runId: string,
  batch: Pick<RoleRunGateBatch, "gate" | "branchRefs">
): Promise<PanelResult<BatchPreview[]>> {
  const out: BatchPreview[] = [];
  for (const branchRef of batch.branchRefs) {
    const preview = await call<{ subjectRefs: string[]; policyVersion: string; expiresAt: number }>(
      fetchFn,
      `/api/role-runs/${encodeURIComponent(runId)}/gate/preview`,
      json({ gate: batch.gate, branchRef })
    );
    if (!preview.ok) return preview;
    out.push({ branchRef, subjectRefs: preview.value.subjectRefs, policyVersion: preview.value.policyVersion, expiresAt: preview.value.expiresAt });
  }
  return { ok: true, value: out };
}
