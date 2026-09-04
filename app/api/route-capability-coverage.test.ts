import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ROUTE-LAYER authorization ratchet — the sibling of route-tenancy-coverage.test.ts,
// asking the other half of the same question. That file asks "does this write reach
// the RIGHT TENANT's rows?"; this one asks "may this SEAT perform it at all?".
//
// The capability vocabulary (app/_lib/auth/roles.ts) is complete and tested, and most
// writes never asked it. A mutating route typically gated on `requireOperator()`,
// which answers "is a trusted, non-demo session present?" — and in open mode (no
// KP_OPERATOR_PASSWORD) answers `true` for everyone. That is identity presence, never
// authorization: a viewer seat satisfied it exactly as well as an owner.
//
// So this is a RATCHET, not a pass/fail audit. It walks every `app/api/**/route.ts`
// that exports a mutating verb (POST/PUT/PATCH/DELETE) and requires either
//
//   • a capability-gate call in the file, or
//   • an entry in ALLOWED below WITH A REASON.
//
// ALLOWED is seeded with every mutating door that was ungated the day this file
// landed, so the count can only FALL: a NEW mutating route with no gate is red
// immediately, and closing an existing door means deleting its line here. The
// remaining count is printed on every run so the slice-by-slice progress is visible
// rather than inferred.
//
// Like its tenancy sibling this is deliberately a SOURCE scan: route handlers need a
// request scope the unit runner cannot give them, and the property asserted — "this
// file asks the capability question" — is exactly what the source states. Whether the
// gate asks for the RIGHT capability is a behavioural question, and that is what
// app/api/write-capability-gate.test.ts drives against the real handlers.

const apiDir = path.dirname(fileURLToPath(import.meta.url));

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walkRoutes(p, out);
    } else if (e.name === "route.ts") {
      out.push(p);
    }
  }
  return out;
}

const MUTATING = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/;
// The three request-scope gates in app/_lib/auth/current-user.ts, plus the coded
// wrapper in api-response.ts that re-shapes their 403 into FORBIDDEN_CAPABILITY.
// A file that calls `can("…")` is NOT counted: that returns a boolean for rendering
// decisions, and "computed a boolean" is not "refused the request".
const GATE = /\b(requireCapabilityCoded|requireCapability|requireWorkspaceCapability|requireOrgCapability)\s*\(/;

/** The mutating verbs a route file exports, in source order. */
export function mutatingVerbs(src: string): string[] {
  const re = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

// ---- the allowlist ---------------------------------------------------------
// Every entry is a mutating door that does NOT ask a capability, with the reason it
// is acceptable — or, for a door that is simply not done yet, the slice that owes it.
// Format: "<api-relative path>" -> reason.
//
// A "slice N candidate" reason is a DEBT MARKER, not an exemption: it says nobody has
// judged the door yet. The structural exemptions (public token surfaces, the demo
// sandbox, self-service, webhooks, cron) are the ones that stay.
//
// TO CLOSE ONE: add the gate to the route, add a behavioural case to
// write-capability-gate.test.ts, DELETE the line here. Never add a line to a route
// that used to be gated.
const ALLOWED = new Map<string, string>([
  ["agents/[id]/refresh/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["agents/bridge/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["agents/dispatch/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["agents/pair/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["agents/report/[token]/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["analyses/[slug]/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["analytics/calibration/apply-threshold/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["analytics/spend/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["analytics/targets/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["analyze/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["apply/[id]/followup/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["apply/[id]/quick/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["apply/[id]/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["apply/[id]/session/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["archetypes/[id]/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["archetypes/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["ats/deliveries/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["ats/test/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["auth/login/route.ts", "self-service — signing IN cannot require a capability the sign-in would grant"],
  ["auth/logout/route.ts", "self-service — ending your own session"],
  ["auth/register/route.ts", "self-service — account creation (feature-gated by KP_SIGNUP_ENABLED)"],
  ["auth/switch-workspace/route.ts", "self-service — gated on the caller's OWN membership in the target team (workspaces-route.test.ts)"],
  ["billing/checkout/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["billing/portal/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["billing/webhook/route.ts", "webhook — Polar posts here with a signed body; there is no seat behind the call"],
  ["brand/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["calendar/google/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["channels/inbound/[token]/route.ts", "webhook — inbound ad/email intake, authed by the channel token in the URL"],
  ["comms/[id]/resend/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["comms/callback/route.ts", "webhook — the relay's delivery receipt, authed by COMMS_CALLBACK_SECRET + timestamp + nonce"],
  ["companion/[id]/message/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["companion/brain/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["companion/proposals/[id]/resolve/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["companion/threads/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["data/[token]/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["devcase/feedback/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["devcase/inbound/route.ts", "webhook — candidate apply intake, token-authed, no session"],
  ["devcase/lifecycle/[id]/close/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["devcase/lifecycle/[id]/redesign/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["devcase/lifecycle/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["devcase/promote/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["devcase/publish/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["devcase/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["devcase/session/[id]/chat/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["devcase/session/[id]/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["devcase/session/[id]/submit/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["devcase/session/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["devcase/skill-profile/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["devcase/source/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["devcase/submit/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["edge/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["extract-text/route.ts", "public utility — stateless text extraction, throttled per IP; it writes nothing"],
  ["github-analysis/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["intake/[id]/attachments/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["intake/[id]/brief/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["intake/[id]/compose-app-master/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["intake/[id]/dossier/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["intake/[id]/message/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["intake/[id]/promote/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["intake/[id]/reopen/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["intake/[id]/voice-complete/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["intake/[id]/voice-connect/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["intake/[id]/voice-turn/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["intake/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["interview-prep/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["interview-prep/scorecard/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["interview/complete/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["interview/connect/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["interview/create/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["interview/revoke/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["interview/simulate/attach/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["interview/simulate/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["invite/[token]/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["jds/[slug]/ingest-job/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["jds/[slug]/retry-analysis/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["jds/[slug]/revisions/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["jds/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["jobs/[id]/agent-fit/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["jobs/[id]/campaign/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["jobs/[id]/candidates/outreach/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["jobs/[id]/close/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["jobs/[id]/publish/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["jobs/ingest/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["llm/test/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["match/reasoning/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["match/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["me/onboarding/route.ts", "self-service — the caller's own onboarding state, nobody else's"],
  ["offer/[token]/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["pipeline/[id]/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["pipeline/outcomes/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["pipeline/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["profile/draft/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["profile/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["rediscovery/alerts/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["repo-scan/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["schedule/[token]/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["schedule/invite/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["schedule/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["sim/apply-cv/route.ts", "guided-sim sandbox — writes only the demo corpus"],
  ["sim/inbound/route.ts", "guided-sim sandbox — writes only the demo corpus"],
  ["sim/offer-draft/route.ts", "guided-sim sandbox — writes only the demo corpus"],
  ["sim/reset/route.ts", "guided-sim sandbox — writes only the demo corpus"],
  ["sim/screen-draft/route.ts", "guided-sim sandbox — writes only the demo corpus"],
  ["status/[token]/nps/route.ts", "public token door — authed by the capability link in the URL, never a seat (public-routes.ts)"],
  ["stt/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["tasks/[id]/retry/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["tasks/[id]/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["tasks/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["tasks/seen/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["templates/[id]/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["templates/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
  ["tts/route.ts", "slice 2 candidate — ungated when this ratchet landed; not yet judged"],
]);

test("every mutating API route asks a capability, or is on the allowlist with a reason", () => {
  const routes = walkRoutes(apiDir);
  assert.ok(routes.length >= 100, `expected to scan the API surface, only found ${routes.length} route files`);

  const ungated: string[] = [];
  let gated = 0;
  for (const f of routes) {
    const src = readFileSync(f, "utf8");
    if (!MUTATING.test(src)) continue;
    const rel = path.relative(apiDir, f).replace(/\\/g, "/");
    if (GATE.test(src)) {
      gated += 1;
      assert.ok(!ALLOWED.has(rel), `${rel} is GATED but still listed in ALLOWED — delete its line, the ratchet only tightens`);
      continue;
    }
    if (!ALLOWED.has(rel)) ungated.push(`${rel}  [${mutatingVerbs(src).join(", ")}]`);
  }

  assert.deepEqual(
    ungated.sort(),
    [],
    `These mutating routes check no capability, so any signed-in seat — a viewer included — may perform them:\n` +
      `  ${ungated.sort().join("\n  ")}\n\n` +
      `Gate them with requireCapabilityCoded("<capability>", requireCapability | requireOrgCapability |\n` +
      `requireWorkspaceCapability) from app/_lib/api-response.ts. If the door is genuinely open by design\n` +
      `(a public token surface, the demo sandbox, self-service, a webhook, a cron trigger), add it to\n` +
      `ALLOWED in this file WITH THE REASON.`,
  );

  // The remaining debt, printed rather than asserted — a number that must only fall.
  const debt = [...ALLOWED.keys()].filter((k) => /slice \d candidate/.test(ALLOWED.get(k) ?? "")).length;
  console.log(`[route-capability-coverage] gated: ${gated}  allowlisted: ${ALLOWED.size}  (of which unjudged debt: ${debt})`);
});

// NON-VACUITY. A ratchet whose entire output is "[] === []" looks identical whether it
// is clean or blind. Drive the same predicates over synthetic sources with a known
// answer so a regression in the scan itself is red rather than quiet.
test("the scanner is not blind: it tells a gated door from an ungated one", () => {
  const gatedSrc = `import { requireCapability } from "@/app/_lib/auth/current-user";
    export async function POST() { const d = await requireCapabilityCoded("pipeline:write", requireCapability); return d; }`;
  const ungatedSrc = `import { requireOperator } from "@/app/_lib/auth/require-operator";
    export async function DELETE() { const d = await requireOperator(); return d; }`;
  const readOnlySrc = `export async function GET() { return null; }`;
  // A boolean capability READ is not a gate: it decides what to render, not what to refuse.
  const booleanOnlySrc = `import { can } from "@/app/_lib/auth/current-user";
    export async function PATCH() { return (await can("pipeline:write")) ? 1 : 2; }`;

  assert.ok(MUTATING.test(ungatedSrc) && GATE.test(gatedSrc), "the predicates must fire on their own shapes");
  assert.ok(!GATE.test(ungatedSrc), "requireOperator alone must NOT count as a capability gate");
  assert.ok(!MUTATING.test(readOnlySrc), "a read-only route is out of scope");
  assert.ok(!GATE.test(booleanOnlySrc), "`can()` computes a boolean; it does not refuse a request");
  assert.deepEqual(mutatingVerbs(`export async function POST(){}\nexport async function DELETE(){}`), ["POST", "DELETE"]);
});
