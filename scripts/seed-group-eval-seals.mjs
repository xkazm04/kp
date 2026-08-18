#!/usr/bin/env node
// UAT LUC-ANA-13 — top the demo corpus up with a group-eval seal that actually carries
// its EU AI Act Art. 12 traceability.
//
// WHY THIS EXISTS AT ALL, AND WHY IT IS NOT A JSON FIXTURE
// -------------------------------------------------------
// `decision_records` has no seed snapshot and cannot have one. The chain accretes at
// runtime, and every link's hash is computed over the link before it — so a checked-in
// fixture would either have to ship pre-computed hashes (which the first real seal
// invalidates) or be rewritten into an existing chain, which is precisely the tampering
// the chain exists to detect. The six group-eval records in the seeded workspace predate
// W0.3: their `inputs` are {score, candidates, roleTitle}, with no `promptVersion` and no
// `leadReasoning`. They MUST STAY THAT WAY. Editing them to make a demo look better is
// forging an audit record, and the panel would report the chain as broken for it.
//
// The honest fixture is therefore an APPEND: run one more real evaluation, through the
// app's own task path, and let the live writer seal a genuine record. Nothing here
// invents a model verdict — the reasoning that lands in the seal is whatever the
// reasoning pipeline actually produced for that cohort (keyless, that is the
// deterministic ranker, and `promptVersion` is honestly empty because no prompt ran).
//
//   node scripts/seed-group-eval-seals.mjs [--base-url http://localhost:3001] [--dry-run]
//
// Requires a RUNNING server against the DB you want topped up (it drives the same
// POST /api/tasks the Decisions modal does — see useSimulationEngine.runGroupEval).
// Idempotent: if any group-eval record in the chain already carries traceability, it
// reports that and does nothing.

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = (flag("--base-url", process.env.KP_BASE_URL || "http://localhost:3001")).replace(/\/$/, "");
const DRY_RUN = args.includes("--dry-run");
// A group eval spawns per-candidate reasoning; keyless it is fast, with an LLM it is not.
const TIMEOUT_MS = Number(flag("--timeout-ms", "120000"));

const getJson = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Does this sealed payload carry the Art. 12 pair? Mirrors parseSealTraceability's
 *  honesty rule (app/_lib/decision-attribution.ts): a block with neither a prompt
 *  version nor any model text carries no traceability and must not count as one. */
function hasTraceability(payloadJson) {
  let inputs;
  try {
    inputs = JSON.parse(payloadJson).inputs;
  } catch {
    return false;
  }
  if (!inputs || typeof inputs !== "object") return false;
  const versions = Array.isArray(inputs.promptVersion) ? inputs.promptVersion.filter((v) => typeof v === "string") : [];
  const lr = inputs.leadReasoning;
  const hasText =
    lr &&
    typeof lr === "object" &&
    (Boolean(lr.verdict) || (Array.isArray(lr.strengths) && lr.strengths.length > 0) || (Array.isArray(lr.gaps) && lr.gaps.length > 0));
  return versions.length > 0 || Boolean(hasText);
}

async function main() {
  const chain = await getJson("/api/decisions/records");
  const groupEvals = (chain.records ?? []).filter((r) => String(r.kind).startsWith("group_eval"));
  const already = groupEvals.filter((r) => hasTraceability(r.payloadJson));
  console.log(`chain: ${(chain.records ?? []).length} records, ${groupEvals.length} group-eval, ${already.length} with traceability`);
  if (already.length > 0) {
    console.log(`nothing to do — record #${already[0].seq} already answers the Art. 12 question`);
    return 0;
  }

  // Pick the role with the deepest live cohort: a lead is only crowned when there is a
  // field to rank it against (a single-candidate role seals nothing at all).
  const board = await getJson("/api/pipeline");
  const byJob = new Map();
  for (const e of board.entries ?? []) {
    if (!e.jobId || e.status !== "active") continue;
    const bucket = byJob.get(e.jobId) ?? { jobId: e.jobId, roleTitle: e.jobTitle ?? "the role", candidates: [] };
    bucket.candidates.push({ entryId: e.id, candidateId: e.candidateId, label: e.candidateLabel, matchScore: e.matchScore });
    byJob.set(e.jobId, bucket);
  }
  const role = [...byJob.values()].sort((a, b) => b.candidates.length - a.candidates.length)[0];
  if (!role || role.candidates.length < 2) {
    console.error("no role has two or more active candidates — a single-candidate field crowns no lead, so nothing would be sealed");
    return 1;
  }
  console.log(`role: ${role.roleTitle} (${role.jobId}) with ${role.candidates.length} active candidates`);
  if (DRY_RUN) {
    console.log("--dry-run: would POST /api/tasks {kind:'group_eval'} for that role and poll for the seal");
    return 0;
  }

  const res = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "group_eval",
      params: { roleKey: role.jobId, roleTitle: role.roleTitle, jobId: role.jobId, candidates: role.candidates },
    }),
  });
  if (!res.ok) throw new Error(`POST /api/tasks → HTTP ${res.status}`);

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(1000);
    const now = await getJson("/api/decisions/records");
    const sealed = (now.records ?? []).find((r) => String(r.kind).startsWith("group_eval") && hasTraceability(r.payloadJson));
    if (sealed) {
      console.log(`sealed record #${sealed.seq} (${sealed.kind}) now carries the Art. 12 pair`);
      // Say plainly when the run was keyless: an empty prompt version is the honest
      // answer there, not a gap, and the detail row renders it as "not recorded".
      const inputs = JSON.parse(sealed.payloadJson).inputs ?? {};
      const versions = inputs.promptVersion ?? [];
      console.log(versions.length > 0 ? `prompt version(s): ${versions.join(", ")}` : "no prompt version: this run had no LLM behind it");
      return 0;
    }
  }
  console.error(`timed out after ${TIMEOUT_MS}ms with no traceability-carrying seal — check the task ran (the eval seals only when a lead passes the knockout gate)`);
  return 1;
}

// `process.exitCode`, never `process.exit()`: fetch leaves keep-alive sockets in the
// global agent, and tearing libuv down under them aborts the process on Windows
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"). Setting the code lets Node
// drain and exit on its own, with the status intact.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
