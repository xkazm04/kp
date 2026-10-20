// The Cohort Studio's four reads and one write, over an injectable fetch (WP3). Every answer
// is a discriminated result: the data, or the failure's CODE payload + HTTP status — never the
// server's English `error` string as something to render (useErrorMessage resolves the code).
// Pure of React; pinned with a stub fetch by cohortStudioApi.test.ts.
import type { CohortProposal, CohortRunRequest, CohortRunResponse, CohortSummary, CohortView } from "./cohortTypes.ts";

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** The failure's payload as the route sent it: `code` for the resolver, plus any ICU values. */
export type ApiFailure = { code: string | null; values: Record<string, string | number>; status: number };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

/** The values a coded refusal carries beside its code (`{ min, max }`, `{ meter, plan }`). */
function failureOf(body: unknown, status: number): ApiFailure {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === "error" || k === "code") continue;
    if (typeof v === "string" || typeof v === "number") values[k] = v;
  }
  return { code: typeof b.code === "string" ? b.code : null, values, status };
}

async function read<T>(f: FetchLike, url: string, guard: (v: unknown) => v is T, init?: Parameters<FetchLike>[1]): Promise<ApiResult<T>> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await f(url, init);
  } catch (err) {
    // An abort is the caller's own cancellation: rethrown so the hook can drop it silently.
    if ((err as { name?: string } | null)?.name === "AbortError") throw err;
    return { ok: false, failure: { code: null, values: {}, status: 0 } };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, failure: failureOf(body, res.status) };
  // A 200 whose body is not the contract is a failure, not an empty answer.
  if (!guard(body)) return { ok: false, failure: { code: null, values: {}, status: res.status } };
  return { ok: true, data: body };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isProposal = (v: unknown): v is CohortProposal => isObj(v) && Array.isArray(v.members) && typeof v.jdSlug === "string";
const isView = (v: unknown): v is CohortView => isObj(v) && Array.isArray(v.members) && typeof v.status === "string" && isObj(v.progress);
const isRun = (v: unknown): v is CohortRunResponse => isObj(v) && typeof v.cohortId === "string";
const isSummaries = (v: unknown): v is CohortSummary[] => Array.isArray(v);

export const fetchProposal = (f: FetchLike, jdSlug: string, signal?: AbortSignal) =>
  read(f, `/api/analyze/cohort/proposal?jd=${encodeURIComponent(jdSlug)}`, isProposal, { signal });

export const fetchCohortView = (f: FetchLike, cohortId: string, signal?: AbortSignal) =>
  read(f, `/api/analyze/cohort/${encodeURIComponent(cohortId)}`, isView, { signal });

export const fetchRecentCohorts = (f: FetchLike, signal?: AbortSignal) => read(f, "/api/analyze/cohort", isSummaries, { signal });

export const startCohort = (f: FetchLike, body: CohortRunRequest) =>
  read(f, "/api/analyze/cohort", isRun, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Whether this install meters AI work (GET /api/billing `metered`). null = not known: the
 *  reader may not hold billing authority, or the read failed — the run sheet then names CVs,
 *  never units, rather than guessing a price. */
export async function fetchMetered(f: FetchLike, signal?: AbortSignal): Promise<boolean | null> {
  const r = await read(f, "/api/billing", (v): v is { metered: boolean } => isObj(v) && typeof v.metered === "boolean", { signal });
  return r.ok ? r.data.metered : null;
}
