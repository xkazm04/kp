import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coerceCompletenessGaps, validateProfileCliResult } from "./apply-profile-result.ts";
import { gapFieldCopy, GAP_FIELDS, mergeGapAnswers } from "./completeness-followup.ts";

// gap-followup-candidate — profile_cli has always reported which archetype
// checklist items a built profile still misses (`missingGaps`), and the gap
// questions have always existed (GAP_FIELDS + mergeGapAnswers). The two were
// never connected to the CANDIDATE, the only person who can answer them:
// validateProfileCliResult destructured the list away, so it stopped at the
// TS/Python boundary. These pin the three seams that now carry it.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

// A well-formed profile_cli payload, shaped like profile_cli.py's stdout JSON.
const cliResult = (extra: Record<string, unknown> = {}) => ({
  profile: { displayName: "Ada", roleFamily: "engineering" },
  archetype: "student",
  completeness: 0.4,
  ...extra,
});

test("the CLI boundary carries missingGaps through instead of discarding it", () => {
  const v = validateProfileCliResult(
    cliResult({
      missingGaps: [
        { check: "has_project_or_thesis", label: "A project or thesis" },
        { check: "has_languages", label: "Languages" },
      ],
    })
  );
  assert.ok(v.ok);
  assert.deepEqual(
    v.value.missingGaps.map((g) => g.check),
    ["has_project_or_thesis", "has_languages"],
    "the gap list reaches the caller in profile_cli's biggest-gap-first order"
  );
});

test("a missing or garbled gap list degrades to [] — never a failed profile build", () => {
  // It is an enrichment nicety; demoting an applicant to a non-matchable stub
  // over it would be wildly disproportionate.
  for (const missingGaps of [undefined, null, "nope", 42, {}, [null, 7, { label: "no check" }]]) {
    const v = validateProfileCliResult(cliResult({ missingGaps }));
    assert.ok(v.ok, `validation must still succeed for ${JSON.stringify(missingGaps)}`);
    assert.deepEqual(v.value.missingGaps, [], `expected [] for ${JSON.stringify(missingGaps)}`);
  }
});

test("the gap list is bounded at the trust boundary (it rides a DB column and a public payload)", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ check: `c${i}`, label: "x".repeat(500) }));
  const out = coerceCompletenessGaps(many);
  assert.ok(out.length <= 12, `expected the list capped, got ${out.length}`);
  assert.ok(out.every((g) => g.label.length <= 160), "each label is capped");
  // An over-long check id is dropped outright rather than truncated into a
  // different (possibly real) id.
  assert.deepEqual(coerceCompletenessGaps([{ check: "c".repeat(65), label: "x" }]), []);
});

test("the candidate's answers round-trip through mergeGapAnswers with self-declared provenance", () => {
  // What the follow-up route does: the stored profile payload + the answers the
  // candidate typed → a merged payload the normalizer re-scores.
  const stored: Record<string, unknown> = {
    displayName: "Ada",
    evidence: [{ kind: "job", title: "Existing", text: "from the CV", skills: [] }],
    skillClaims: [{ skill: "Python", provenance: "evidence" }],
    completenessGaps: [{ check: "min_3_skills", label: "Skills" }],
  };
  const merged = mergeGapAnswers(stored, {
    has_project_or_thesis: "Bachelor thesis: a lab scheduling API",
    min_3_skills: "SQL, Git",
    has_years: "4",
  });

  // The transient gap list never survives into the saved payload.
  assert.ok(!("completenessGaps" in merged));
  // The story became TYPED evidence, appended (never replacing the CV's).
  const evidence = merged.evidence as { kind: string; text: string }[];
  assert.equal(evidence.length, 2);
  assert.equal(evidence[0].text, "from the CV");
  assert.equal(evidence[1].kind, "project");
  // New skills enter as self_declared claims; the CV-evidenced one is untouched.
  const claims = merged.skillClaims as { skill: string; provenance: string }[];
  assert.deepEqual(
    claims.map((c) => [c.skill, c.provenance]),
    [
      ["Python", "evidence"],
      ["SQL", "self_declared"],
      ["Git", "self_declared"],
    ]
  );
  assert.equal(merged.yearsExperience, 4);
  // The input is not mutated — the caller still holds the pre-merge payload.
  assert.equal((stored.evidence as unknown[]).length, 1);
});

test("every gap field's copy is translator-injected, not hardcoded English", () => {
  // The prompts are now asked of the CANDIDATE too, so they must render in the
  // candidate's language. The pure module holds only the catalog KEY.
  const seen: string[] = [];
  const fakeT = ((key: string) => {
    seen.push(key);
    return `[${key}]`;
  }) as Parameters<typeof gapFieldCopy>[1];

  for (const check of Object.keys(GAP_FIELDS)) {
    const copy = gapFieldCopy(check, fakeT);
    assert.ok(copy, `no copy for "${check}"`);
    assert.match(copy.prompt, /^\[.+\.prompt\]$/, `"${check}" prompt must come from the catalog`);
    assert.match(copy.placeholder, /^\[.+\.placeholder\]$/, `"${check}" placeholder must come from the catalog`);
  }
  assert.equal(seen.length, Object.keys(GAP_FIELDS).length * 2);
  // An unknown/new checklist id renders nothing rather than a label with no input.
  assert.equal(gapFieldCopy("no_such_check", fakeT), null);

  // …and every key the module composes actually exists in the default catalog.
  const en = JSON.parse(read("../../messages/en.json")) as {
    apply: { gapFields: Record<string, { prompt?: string; placeholder?: string }> };
  };
  for (const spec of Object.values(GAP_FIELDS)) {
    const entry = en.apply.gapFields[spec.key];
    assert.ok(entry, `messages/en.json is missing apply.gapFields.${spec.key}`);
    assert.equal(typeof entry.prompt, "string");
    assert.equal(typeof entry.placeholder, "string");
  }
});

// ---------------------------------------------------------------------------
// The follow-up route's AUTH + blast radius. Source-contract (importing the route
// pulls in next/server, which the unit runner can't resolve) — the repo pattern
// for exactly this.
// ---------------------------------------------------------------------------

const routeSrc = read("../api/apply/[id]/followup/route.ts");

test("the follow-up route is capability-token-authenticated, never keyed off a client entry id", () => {
  assert.match(routeSrc, /coerceLeadTokenParam\(body\.lead\)/, "the token is shape-gated before it touches the DB");
  assert.match(routeSrc, /findEntryByLeadToken\(token\)/, "the entry is resolved FROM the token");
  assert.match(
    routeSrc,
    /target\.entry\.jobId !== job\.id/,
    "a token for another role cannot be replayed against this one"
  );
  // The hard invariant: no path may take an entry id from the request body.
  assert.doesNotMatch(routeSrc, /body\.entryId|body\.entry\b/, "an entry id from the client is an IDOR handle");
  assert.doesNotMatch(routeSrc, /getPipelineEntry\(/, "the entry must come from the token lookup only");
});

test("the follow-up route throttles like its public siblings, before any read or spawn", () => {
  assert.match(routeSrc, /const FOLLOWUP_RATE_LIMIT = \{ limit: \d+, windowMs: [\d_]+ \}/, "an explicit bound");
  assert.match(routeSrc, /RATE_LIMITED_ERROR \}, \{ status: 429 \}/, "the shared 429 envelope");
  const limitAt = routeSrc.indexOf("rateLimit(");
  const readAt = routeSrc.indexOf("findEntryByLeadToken(");
  const spawnAt = routeSrc.indexOf("renormalizeApplicantProfile(");
  assert.ok(limitAt > 0 && limitAt < readAt && limitAt < spawnAt, "a flood is rejected before the store read and the spawn");
  assert.match(routeSrc, /MAX_FOLLOWUP_BODY_BYTES/, "the body is capped like both apply routes");
  assert.match(routeSrc, /safeJsonError\(error, "api:apply:followup"/, "internals never reach an anonymous caller");
});

test("only gaps actually RECORDED for that entry can be answered, and unanswered ones stay recorded", () => {
  assert.match(routeSrc, /entryProfileGaps\(entry\.id, workspaceId\)/, "the recorded list is the authority");
  assert.match(
    routeSrc,
    /!recorded\.has\(check\) \|\| !GAP_FIELDS\[check\]/,
    "an invented field — or a gap already closed — is dropped, not merged"
  );
  // The rewrite uses the FRESH list from the re-normalization, so a gap an answer
  // didn't actually close stays on the record.
  assert.match(routeSrc, /setEntryProfileGaps\(entry\.id, rebuilt\.missingGaps, workspaceId\)/);
  assert.match(routeSrc, /if \(!rebuilt\.ok\)/, "a failed merge writes nothing and clears nothing");
});

test("the accept response offers the follow-up additively and never blocks the application", () => {
  const applySrc = read("../api/apply/[id]/route.ts");
  assert.match(applySrc, /recordAndOfferGaps\(entry\.id, built\.missingGaps, workspaceId\)/, "first-time accept records + offers");
  assert.match(applySrc, /recordAndOfferGaps\(existing\.id, rebuilt\.missingGaps, workspaceId\)/, "an enriching repeat does too");
  assert.match(applySrc, /ensureLeadEnrichToken\(entryId, undefined, workspaceId\)/, "the capability reuses the lead-enrichment token");
  assert.match(applySrc, /const MAX_FOLLOWUP_QUESTIONS = 3/, "the ask stays small");
  // Every step is inside try/catch and returns {} — the application is already filed.
  assert.match(applySrc, /return \{\};\r?\n\s*\}\r?\n\}/, "a failure degrades to 'no follow-up offered'");
});

test("the candidate's follow-up UI is optional by construction", () => {
  // ConversationalApply.tsx was split (F6a); the contract is unchanged but now
  // spans the view, its follow-up block and the hook that posts. Each assertion
  // is re-pointed at the file that owns that half, so the test still fails if the
  // behaviour regresses rather than merely if the code moves.
  const view = read("../apply/[id]/ConversationalApply.tsx");
  const block = read("../apply/[id]/ApplyFollowup.tsx");
  const hook = read("../apply/[id]/use-apply-followup.ts");
  assert.match(view, /gapState !== "dismissed"/, "it can be dismissed outright");
  assert.match(hook, /setGapState\("dismissed"\)/, "…by an always-available skip control");
  assert.match(block, /t\("followup\.skip"\)/, "…with localized copy");
  // It renders only AFTER an accepted outcome, i.e. below the "You're in" card.
  assert.match(view, /done\.result === "accepted" && done\.followupToken/, "only offered once the application is filed");
  assert.match(hook, /lead: followupToken/, "the POST carries the capability token, not an entry id");
  assert.match(view, /submitGapAnswers\(done\.followupToken\)/, "…and the view supplies that token");
});
