// Pins the CHANNEL the candidate-facing AI disclosure gets its two legal facts
// through: the regime it names, and the consent-retention window it quotes.
//
// WHY THIS TEST EXISTS. `AiDisclosure` used to self-resolve both by fetching
// GET /api/compliance from the browser, defaulting to the EU regime and 12 months
// until that landed. It never landed on a real deployment: the route is not on the
// public allow-list (app/_lib/auth/public-routes.ts), so with KP_OPERATOR_PASSWORD
// set the fail-closed proxy 401s it — and even unauthenticated it answers for the
// CALLER's workspace, which for an anonymous candidate is the default one, not the
// team whose job they are reading. So a `us` workspace told its candidates they
// were assessed under EU equal-treatment directives and processed under GDPR: the
// wrong law, permanently, on the exact surface where GDPR Art. 13's information
// duty bites. Both failures point the same way, toward UNDER-disclosure.
//
// The fix is structural — every public surface resolves the values server-side
// from its own token/job and passes them as props — so the regression that matters
// is structural too: someone adds a ninth candidate surface, renders a bare
// `<AiDisclosure />`, and it quietly reverts to asserting EU law. Nothing about
// that reads as a bug on the screen. This test is what notices.
//
// It reads source text rather than rendering: node:test has no DOM, and the
// property being pinned ("this call site was GIVEN the values") is visible in the
// JSX itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..");

/** Every PUBLIC candidate surface that renders the disclosure. Each one must hand
 *  it a server-resolved regime, because none of them can carry a session. */
const PUBLIC_SURFACES = [
  "apply/[id]/ConversationalApply.tsx",
  "apply/[id]/quick/QuickApplyForm.tsx",
  "devcase/apply/[token]/page.tsx",
  "interview/[token]/page.tsx",
  "schedule/[token]/page.tsx",
  "status/[token]/StatusClient.tsx",
  "offer/[token]/OfferClient.tsx",
];

/** The one render site allowed to fall back to the client fetch, with the reason
 *  it is allowed. Adding an entry here is a deliberate act: it means the surface
 *  carries an operator session, so GET /api/compliance is both reachable through
 *  the gate AND resolves the right tenant via currentWorkspace(). */
const FETCH_FALLBACK_SITES: Record<string, string> = {
  "features/tools/interview/InterviewSimTab.tsx":
    "recruiter-facing simulator inside the authenticated shell — session-bearing, so /api/compliance is reachable and tenant-correct",
};

/** Not a render site: the component, and the tests about it. */
const NOT_A_RENDER_SITE = new Set([
  "_components/AiDisclosure.tsx",
  "_components/ai-disclosure-copy.test.ts",
  "_components/ai-disclosure-props.test.ts",
  "lint-selector-coverage.test.ts",
]);

const SKIP_DIRS = new Set(["node_modules", ".next"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = (full: string) => path.relative(APP, full).split(path.sep).join("/");
const read = (relPath: string) => readFileSync(path.join(APP, relPath), "utf-8");

/** Files that actually render `<AiDisclosure …>` (not merely mention the name). */
function renderSites(): string[] {
  return walk(APP)
    .filter((full) => /<AiDisclosure[\s/>]/.test(readFileSync(full, "utf-8")))
    .map(rel)
    .filter((r) => !NOT_A_RENDER_SITE.has(r))
    .sort();
}

test("every render site of the disclosure is accounted for — no silent ninth surface", () => {
  const declared = new Set([...PUBLIC_SURFACES, ...Object.keys(FETCH_FALLBACK_SITES)]);
  const found = renderSites();
  for (const site of found) {
    assert.ok(
      declared.has(site),
      `${site} renders <AiDisclosure> but is not declared here. If it is a PUBLIC candidate surface, ` +
        `resolve the workspace server-side (disclosureComplianceFor) and pass regimeId/retentionMonths, ` +
        `then add it to PUBLIC_SURFACES. If it is session-bearing, add it to FETCH_FALLBACK_SITES with the reason.`
    );
  }
  for (const site of declared) {
    assert.ok(found.includes(site), `${site} is declared here but no longer renders <AiDisclosure> — drop the entry`);
  }
});

test("every PUBLIC surface hands the disclosure a server-resolved regime and retention window", () => {
  for (const site of PUBLIC_SURFACES) {
    const src = read(site);
    // Each <AiDisclosure …> element on the surface, individually: QuickApplyForm
    // mounts it twice (the done card and the form) and only ONE of them being fed
    // is exactly the half-migration this pins against.
    // No `s` flag needed (and the tsconfig target forbids it): the negated class
    // `[^>]` already spans newlines, which is what a multi-line element needs.
    const elements = src.match(/<AiDisclosure[\s>][^>]*?\/?>/g) ?? [];
    assert.ok(elements.length > 0, `${site}: expected at least one <AiDisclosure> element`);
    for (const el of elements) {
      assert.match(
        el,
        /regimeId=\{/,
        `${site}: this <AiDisclosure> asserts a jurisdiction it was not given — it would fall back to the EU ` +
          `default on every non-EU workspace. Pass regimeId={…} from disclosureComplianceFor(<this surface's workspace>).`
      );
      assert.match(
        el,
        /retentionMonths=\{/,
        `${site}: this <AiDisclosure> would quote the hardcoded 12-month window instead of the enforced ` +
          `KP_CONSENT_TTL_DAYS one. Pass retentionMonths={…} from the same call.`
      );
    }
  }
});

test("each public surface resolves the regime from its OWN workspace, not a bare default", () => {
  // The prop is only worth anything if the value behind it came from this
  // surface's tenant. A surface that passed `regimeId={DEFAULT_REGIME_ID}` would
  // satisfy the test above and change nothing — so require the server resolver to
  // appear in the surface's own file or in the server component that renders it.
  const serverOwner: Record<string, string> = {
    "apply/[id]/ConversationalApply.tsx": "apply/[id]/page.tsx",
    "apply/[id]/quick/QuickApplyForm.tsx": "apply/[id]/quick/page.tsx",
    "status/[token]/StatusClient.tsx": "status/[token]/page.tsx",
    "offer/[token]/OfferClient.tsx": "offer/[token]/page.tsx",
  };
  for (const site of PUBLIC_SURFACES) {
    const owner = serverOwner[site] ?? site;
    const src = read(owner);
    assert.match(
      src,
      /disclosureComplianceFor\(/,
      `${owner}: must resolve the disclosure's regime through disclosureComplianceFor(<workspace>) — ` +
        `passing a constant would satisfy the prop while re-introducing the defect`
    );
    assert.doesNotMatch(
      src,
      /disclosureComplianceFor\(\s*\)/,
      `${owner}: disclosureComplianceFor() with no workspace resolves the DEFAULT team, which is the bug`
    );
  }
});

test("the component only skips the fetch when it was actually given a regime", () => {
  const src = read("_components/AiDisclosure.tsx");
  assert.match(
    src,
    /const serverResolved = regimeId !== undefined/,
    "the presence of the prop is the discriminator — a truthiness check would re-fetch for a legitimate value"
  );
  assert.match(src, /if \(serverResolved\) return;/, "a prop-fed surface must not open the (gated) endpoint at all");
  // The EU default must survive as the LAST resort, after the prop and the fetch.
  assert.match(
    src,
    /regimeId \?\? fetched\.regimeId \?\? DEFAULT_REGIME_ID/,
    "precedence must be prop → fetch → the shipped EU default"
  );
});

test("/api/compliance is still gated — the prop path is the fix, not the allow-list", () => {
  // Allow-listing the route would NOT fix the candidate half: an anonymous request
  // carries no workspace, so it would answer for the default team, and making it
  // tenant-aware for a public caller means trusting a caller-supplied workspace id
  // — i.e. letting anyone enumerate any team's legal posture.
  const allowList = readFileSync(path.join(APP, "_lib/auth/public-routes.ts"), "utf-8");
  assert.doesNotMatch(
    allowList,
    /"\/api\/compliance/,
    "/api/compliance must stay off the public allow-list; candidate surfaces get their values as props"
  );
});
