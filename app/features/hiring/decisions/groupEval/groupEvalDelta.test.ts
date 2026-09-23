// Acceptance cases for challenge-r03 group-eval-comparison/B: the drift notice names
// who joined and who left, and a Re-run states what moved, restricted to the claims
// the two records support (registry recruiting/comparative-shortlist-evaluation: the
// comparison is bound to the pool it compared; a lead inside the confidence band is
// not a change of lead).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capNames, poolChange, rerunDelta } from "./groupEvalDelta";
import { poolDrift } from "./groupEvalOpenMachine";
import type { EvalCandidate, GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";

const cand = (label: string, entryId?: string): EvalCandidate => ({ label, entryId }) as EvalCandidate;

const run = (
  labels: string[],
  topPick: string | null,
  extra: Partial<GroupEvalPayload> = {}
): GroupEvalPayload => ({
  candidates: labels.map((l) => cand(l, `id-${l}`)),
  topPick: topPick ? { label: topPick, entryId: `id-${topPick}`, score: 80, why: "" } : null,
  ...extra,
});

describe("poolChange", () => {
  it("names who joined and who left by entry id", () => {
    assert.deepEqual(
      poolChange({ evaluatedIds: ["a", "b", "c"], evaluatedLabels: ["Ann", "Bob", "Cy"] }, [
        { id: "b", label: "Bob" },
        { id: "c", label: "Cy" },
        { id: "d", label: "Dee" },
      ]),
      { joined: ["Dee"], left: ["Ann"] }
    );
  });

  it("falls back to labels on a legacy payload, and to null when it carries neither", () => {
    assert.deepEqual(
      poolChange({ evaluatedLabels: ["Ann", "Bob"] }, [
        { id: "x", label: "Bob" },
        { id: "y", label: "Cy" },
      ]),
      { joined: ["Cy"], left: ["Ann"] }
    );
    assert.equal(poolChange({}, [{ id: "x", label: "Bob" }]), null);
    assert.equal(poolChange(null, [{ id: "x", label: "Bob" }]), null);
  });

  it("names exactly as many people as poolDrift counts", () => {
    const cases: { payload: { evaluatedIds?: string[]; evaluatedLabels?: string[] }; entries: { id: string; label: string }[] }[] = [
      { payload: { evaluatedIds: ["a", "b", "c"], evaluatedLabels: ["Ann", "Bob", "Cy"] }, entries: [{ id: "b", label: "Bob" }, { id: "d", label: "Dee" }, { id: "e", label: "Eve" }] },
      { payload: { evaluatedLabels: ["Ann", "Bob"] }, entries: [{ id: "x", label: "Bob" }, { id: "y", label: "Cy" }] },
    ];
    for (const { payload, entries } of cases) {
      const change = poolChange(payload, entries);
      assert.ok(change);
      const drift = poolDrift(payload, { entries: entries.map((e) => ({ id: e.id, candidateLabel: e.label })) });
      assert.equal(change.joined.length + change.left.length, drift);
    }
  });

  it("never fabricates a name for a departed id whose label was not recorded", () => {
    // ids without a parallel label list: who LEFT cannot be named, so no names at all.
    assert.equal(poolChange({ evaluatedIds: ["a", "b"] }, [{ id: "b", label: "Bob" }]), null);
  });
});

describe("rerunDelta", () => {
  it("diffs the lead and the ranks over the same field", () => {
    const d = rerunDelta(run(["A", "B", "C"], "A"), run(["B", "A", "C"], "B"));
    assert.ok(d);
    assert.equal(d.fieldChanged, false);
    assert.deepEqual(d.lead, { from: "A", to: "B", fromId: "id-A", toId: "id-B" });
    assert.deepEqual(d.moves, [
      { id: "id-B", label: "B", from: 2, to: 1 },
      { id: "id-A", label: "A", from: 1, to: 2 },
    ]);
    assert.ok(!d.moves.some((m) => m.label === "C"));
    assert.equal(d.unchanged, false);
  });

  it("reports an unchanged run as unchanged, not as an empty diff", () => {
    const d = rerunDelta(run(["A", "B", "C"], "A"), run(["A", "B", "C"], "A"));
    assert.ok(d);
    assert.equal(d.unchanged, true);
    assert.deepEqual(d.moves, []);
    assert.equal(d.lead, null);
  });

  it("restricts position claims to the members compared both times when the field changed", () => {
    // Prev [A,B,C], next [A,D,B]: B is 3rd of the new field but 2nd among the common
    // members both times, so B did NOT move - no 'moved from 2nd to 3rd' claim.
    const d = rerunDelta(run(["A", "B", "C"], "A"), run(["A", "D", "B"], "A"));
    assert.ok(d);
    assert.equal(d.fieldChanged, true);
    assert.deepEqual(d.entered, ["D"]);
    assert.deepEqual(d.dropped, ["C"]);
    assert.equal(d.common, 2);
    assert.deepEqual(d.moves, []);
    assert.equal(d.unchanged, false);

    const swapped = rerunDelta(run(["A", "B", "C"], "A"), run(["B", "A", "D"], "B"));
    assert.ok(swapped);
    assert.deepEqual(swapped.moves, [
      { id: "id-B", label: "B", from: 2, to: 1 },
      { id: "id-A", label: "A", from: 1, to: 2 },
    ]);
  });

  it("a run that names no lead is not 'A lost the lead', and a mode change is stated", () => {
    const d = rerunDelta(
      run(["A", "B"], "A", { governanceMode: "recommendation" }),
      run(["A", "B"], null, { governanceMode: "committee" })
    );
    assert.ok(d);
    assert.deepEqual(d.lead, { from: "A", to: null, fromId: "id-A", toId: null, reason: "no_lead" });
    assert.equal(d.modeChanged, true);
    assert.deepEqual(d.mode, { from: "recommendation", to: "committee" });

    // A legacy payload with no mode reads as the default recommendation mode.
    const same = rerunDelta(run(["A", "B"], "A"), run(["A", "B"], "A", { governanceMode: "recommendation" }));
    assert.equal(same?.modeChanged, false);
  });

  it("a new lead inside the confidence band is a tie, not a change of lead", () => {
    const d = rerunDelta(run(["A", "B"], "A"), run(["B", "A"], "B", { leadSeparation: "overlapping" }));
    assert.ok(d);
    assert.equal(d.lead?.reason, "within_band");
    const clear = rerunDelta(run(["A", "B"], "A"), run(["B", "A"], "B", { leadSeparation: "separated" }));
    assert.equal(clear?.lead?.reason, undefined);
  });

  it("tracks two candidates with the same label separately by entry id", () => {
    const prev: GroupEvalPayload = {
      candidates: [cand("Jan Novak", "e1"), cand("Jan Novak", "e2"), cand("Eva", "e3")],
      topPick: { label: "Jan Novak", entryId: "e1", score: 80, why: "" },
    };
    const next: GroupEvalPayload = {
      candidates: [cand("Jan Novak", "e2"), cand("Jan Novak", "e1"), cand("Eva", "e3")],
      topPick: { label: "Jan Novak", entryId: "e2", score: 80, why: "" },
    };
    const d = rerunDelta(prev, next);
    assert.ok(d);
    assert.equal(d.fieldChanged, false);
    assert.deepEqual(d.lead, { from: "Jan Novak", to: "Jan Novak", fromId: "e1", toId: "e2" });
    assert.deepEqual(
      d.moves.map((m) => [m.id, m.from, m.to]),
      [
        ["e2", 2, 1],
        ["e1", 1, 2],
      ]
    );
  });

  it("returns null when there is no previous run to compare against", () => {
    assert.equal(rerunDelta(null, run(["A"], "A")), null);
    assert.equal(rerunDelta(run(["A"], "A"), null), null);
  });
});

describe("capNames", () => {
  it("keeps a sentence short and counts the rest", () => {
    assert.deepEqual(capNames(["A", "B"], 5), { shown: ["A", "B"], more: 0 });
    assert.deepEqual(capNames(["A", "B", "C", "D"], 2), { shown: ["A", "B"], more: 2 });
  });
});
