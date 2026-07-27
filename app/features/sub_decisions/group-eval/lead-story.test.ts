// The lead's story had two holes.
//
// (a) topPick persisted only {label, score, why} even though the lead's entryId was in
//     hand at seal time — so the "Unique strengths" chips, the LAST label-keyed
//     comparison in a module that keys everything else by candIdentity, landed on the
//     RIVAL's tab whenever two candidates share a display name.
// (b) payload.leadSeparation ("overlapping" = the top two are a tie once both
//     confidence bands are taken into account) was computed and SEALED into the audit
//     record but rendered NOWHERE: the hedge rode the deterministic summary, which
//     AiVerdict discards whenever an LLM comparison exists. The recruiter saw a
//     confident crown that the audit record itself hedged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isTopPick } from "./helpers.ts";
import type { EvalCandidate, GroupEvalPayload } from "./types.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(path.join(dir, f), "utf8");

const cand = (label: string, entryId?: string): EvalCandidate =>
  ({ label, entryId, score: 70, seniority: null, verdict: "", strengths: [], gaps: [] }) as EvalCandidate;

const pick = (p: Partial<NonNullable<GroupEvalPayload["topPick"]>>): GroupEvalPayload["topPick"] =>
  ({ label: "Jan Novák", score: 70, why: "", ...p }) as NonNullable<GroupEvalPayload["topPick"]>;

// ---- (a) identity ---------------------------------------------------------

test("with duplicate display names, only the candidate with the lead's entryId is the top pick", () => {
  const lead = cand("Jan Novák", "entry-1");
  const rival = cand("Jan Novák", "entry-2");
  const topPick = pick({ entryId: "entry-1" });
  assert.equal(isTopPick(lead, topPick), true);
  assert.equal(isTopPick(rival, topPick), false, "the rival must not wear the lead's unique-strengths chips");
});

test("a LEGACY payload without entryId keeps the label fallback (exactly the old behaviour)", () => {
  const topPick = pick({});
  assert.equal(isTopPick(cand("Jan Novák", "entry-1"), topPick), true);
  assert.equal(isTopPick(cand("Eva Dvořáková", "entry-2"), topPick), false);
  // …including for a payload old enough that the candidates carry no ids either.
  assert.equal(isTopPick(cand("Jan Novák"), topPick), true);
});

test("no crowned lead means no candidate is the top pick", () => {
  assert.equal(isTopPick(cand("Jan Novák", "entry-1"), null), false);
  assert.equal(isTopPick(cand("Jan Novák", "entry-1"), undefined), false);
});

test("the per-candidate tabs key the lead's chips on identity, not the label", () => {
  const src = read("PerCandidateTabs.tsx");
  assert.match(src, /isTopPick\(c, topPick\)/, "the chips must gate on isTopPick");
  assert.doesNotMatch(src, /topPick === c\.label/, "the label-keyed comparison must be gone");
});

// ---- (b) the hedge --------------------------------------------------------

test("an overlapping lead separation renders a visible hedge beside the crown", () => {
  const table = read("ComparisonTable.tsx");
  assert.match(table, /leadSeparation === "overlapping"/, "the table must react to an overlapping separation");
  assert.match(table, /t\("leadTied"\)/, "the hedge chip must render localized copy");
  // Only "overlapping" hedges: "separated" needs none and "unknown" must never be
  // rendered as either reassurance or a hedge.
  assert.doesNotMatch(table, /leadSeparation === "unknown"/);
  const legacy = read("LegacyView.tsx");
  assert.match(legacy, /leadSeparation === "overlapping"/, "the compact lead card must hedge too");
});

test("the hedge copy exists in every locale", () => {
  const root = path.join(dir, "..", "..", "..", "..");
  for (const loc of ["en", "cs", "de", "fr"]) {
    const m = JSON.parse(readFileSync(path.join(root, "messages", `${loc}.json`), "utf8")) as {
      decisions: { groupEval: Record<string, string> };
    };
    for (const key of ["leadTied", "leadTiedTitle"]) {
      assert.ok(m.decisions.groupEval[key]?.length, `${loc}.json is missing decisions.groupEval.${key}`);
    }
  }
});

test("the sealed separation contract still names its reader (no orphan field)", () => {
  const types = read("types.ts");
  assert.match(types, /ComparisonTable/, "the leadSeparation comment must name the surface that renders it");
});
