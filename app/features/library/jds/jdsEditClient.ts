// Pure, React-free core of the ONE JD edit client shared by the public JD page
// (JdActions) and the library ledger's in-modal editor (JdModalEditor). Both
// drive the same PATCH /api/jds/[slug] + POST /api/jds/[slug]/revisions routes
// with content-CAS (baseBody) optimistic concurrency. This module is the single
// source of truth for the request shapes and the response→outcome
// classification so the two surfaces can never again drift on WHAT a write means
// — and they HAD: the ledger editor grew a 401 operator gate + 409 conflict path
// the public page never got. Kept free of React (the hook `useJdEditor` wraps it)
// so the CAS semantics are unit-testable in isolation.

export type JdRevision = { id: number; title: string; body: string; created_at: string };

// PATCH body for an in-place edit. `baseBody` is the body the editor LOADED — the
// route compares it against the stored body in ONE transaction and refuses
// (409/conflict) a stale write rather than clobbering a concurrent edit (the
// round-5 honest-CAS contract). An editor save must never omit it.
export function jdEditPayload(
  title: string,
  body: string,
  baseBody: string
): { title: string; body: string; baseBody: string } {
  return { title, body, baseBody };
}

// POST body to revert to a snapshot. Carries the loaded `baseBody` for the same
// CAS reason — a revert can't bury an edit made in another tab meanwhile.
export function jdRevertPayload(
  revisionId: number,
  baseBody: string
): { revisionId: number; baseBody: string } {
  return { revisionId, baseBody };
}

// The four outcomes a JD write (save or revert) resolves to, derived from the
// HTTP status + parsed body. The ORDER is load-bearing and mirrors the historical
// client behavior exactly:
//   401                            → "gate"     (operator-only; latch the controls)
//   409 OR body.code === "conflict" → "conflict" (stale base; offer reload)
//   non-2xx                         → "error"    (surface body.error or a fallback)
//   otherwise                       → "ok"
// The conflict check precedes the ok check so a 2xx that still carries
// code:"conflict" (belt-and-suspenders from the route) is treated as a conflict —
// exactly as the ledger editor did before this extraction.
export type JdWriteOutcome = "ok" | "gate" | "conflict" | "error";

export function classifyJdWriteResponse(
  status: number,
  body: { code?: string; error?: string } | null | undefined
): JdWriteOutcome {
  if (status === 401) return "gate";
  if (status === 409 || body?.code === "conflict") return "conflict";
  if (status < 200 || status >= 300) return "error";
  return "ok";
}

// ---- The two async halves, kept here (and not in the hook) so a fetch stub can
// pin them. `fetchImpl` defaults to the global fetch; a test passes its own.

export type JdFetch = (input: string, init?: RequestInit) => Promise<Response>;

// One JD write (save or revert) against a route, classified. The hook does the
// state; the network + classification live here, where a stub can drive every
// branch — the 401 gate latch and the 409 conflict flag had no test at all.
export async function performJdWrite(
  url: string,
  method: "PATCH" | "POST",
  payload: unknown,
  fetchImpl: JdFetch = fetch
): Promise<{ outcome: JdWriteOutcome; body: { code?: string; error?: string } | null }> {
  const r = await fetchImpl(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await r.json().catch(() => null)) as { code?: string; error?: string } | null;
  return { outcome: classifyJdWriteResponse(r.status, body), body };
}

// Load a JD's revision history. THROWS on a failed request or an unusable body —
// the caller distinguishes "could not load" from "no history", which the old
// `catch { setRevisions([]) }` made impossible: a dropped fetch and a JD that was
// never edited rendered the identical "no history yet" line.
export async function fetchJdRevisions(slug: string, fetchImpl: JdFetch = fetch): Promise<JdRevision[]> {
  const r = await fetchImpl(`/api/jds/${encodeURIComponent(slug)}/revisions`);
  if (!r.ok) throw new Error(`revisions ${r.status}`);
  const p = (await r.json()) as { revisions?: JdRevision[] } | null;
  if (!p || !Array.isArray(p.revisions)) throw new Error("revisions: unexpected body");
  return p.revisions;
}
