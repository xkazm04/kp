// THE CANDIDATE'S DECISION-KIND COPY MAP IS PINNED TO THE SERVER'S ALLOWLIST
// (/perfect, schedule-door-speaks-the-candidates-language).
//
// `CANDIDATE_VISIBLE_DECISION_KINDS` (app/_lib/status-decisions.ts) decides which sealed
// record kinds may cross onto the candidate's own wire. StatusClient.tsx keeps a hand-typed
// literal map of the SAME fourteen kinds, because next-intl rejects template-literal keys —
// so the two are a mirror that nothing compared. A kind added to the server allowlist
// without copy here degrades to a de-snaked raw value ("group_eval_advisory") on an EU
// AI-Act Art. 86 explanation surface, in every locale.
//
// Source-level on the client half for the same reason the map is a literal in the first
// place: it is a React client component, and what is being pinned — "which keys the literal
// declares" — is something the source states exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANDIDATE_VISIBLE_DECISION_KINDS } from "../../_lib/status-decisions.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(path.join(HERE, "StatusClient.tsx"), "utf8");

/** The keys of the `decisionKindLabels` literal, read out of the source. */
function clientKinds(): string[] {
  const at = clientSrc.indexOf("const decisionKindLabels: Record<string, string> = {");
  assert.ok(at >= 0, "StatusClient must keep the copy map a readable literal");
  const body = clientSrc.slice(at, clientSrc.indexOf("\n  };", at));
  return [...body.matchAll(/^\s{4}([a-z_]+): t\(/gm)].map((m) => m[1]);
}

test("every kind the server may expose has candidate copy on the page", () => {
  const declared = new Set(clientKinds());
  assert.ok(declared.size >= 14, `expected the full copy map, found ${declared.size}`);
  for (const kind of CANDIDATE_VISIBLE_DECISION_KINDS) {
    assert.ok(declared.has(kind), `StatusClient has no decisions.kinds copy for the visible kind "${kind}"`);
  }
});

test("the page carries no copy for a kind the server never exposes", () => {
  // The other direction, which matters just as much on this surface: dead copy for a kind
  // that is deliberately withheld (screen_wave_holdout, the policy seals) reads as a
  // promise the projection does not keep.
  for (const kind of clientKinds()) {
    assert.ok(
      CANDIDATE_VISIBLE_DECISION_KINDS.has(kind),
      `StatusClient carries copy for "${kind}", which is not in CANDIDATE_VISIBLE_DECISION_KINDS`
    );
  }
});
