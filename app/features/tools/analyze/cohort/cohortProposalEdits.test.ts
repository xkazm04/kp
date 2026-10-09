import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMember,
  freshEstimate,
  groupByMembership,
  memberFromPopulation,
  populationOffer,
  removeMember,
  retryRequest,
  runRequest,
  runVerdict,
  trayFromProposal,
  trayIsFull,
  type PopulationLite,
  type Tray,
  type TrayMember,
} from "./cohortProposalEdits.ts";
import { COHORT_CAP, type CohortProposal, type CohortView, type Membership, type ProposalMember } from "./cohortTypes.ts";

const pm = (memberId: string, membership: Membership, reusable = false): ProposalMember => ({
  memberId,
  label: memberId,
  source: { kind: "analysis", slug: memberId },
  membership,
  roleFamily: null,
  seniority: null,
  matchScore: 50,
  reusable,
});
const proposal = (members: ProposalMember[]): CohortProposal => ({
  jdSlug: "jd",
  jdTitle: "Role",
  companyText: null,
  orgName: null,
  members,
  leftOut: { applicants: 0, matched: 0 },
  cap: COHORT_CAP,
  freshCount: members.filter((m) => !m.reusable).length,
});
const added = (id: string): TrayMember => ({ ...pm(id, "added"), reuseKnown: false });

test("removing a proposal member keeps it aside; removing a hand-added one does not", () => {
  let tray = trayFromProposal(proposal([pm("a", "applicant"), pm("b", "matched")]));
  tray = addMember(tray, added("c")).tray;
  tray = removeMember(tray, "a");
  tray = removeMember(tray, "c");
  assert.deepEqual(tray.members.map((m) => m.memberId), ["b"]);
  assert.deepEqual(tray.removed.map((m) => m.memberId), ["a"]);
  assert.equal(removeMember(tray, "nobody"), tray);
});

test("putting a removed member back restores its rule and clears it from the removed list", () => {
  let tray = removeMember(trayFromProposal(proposal([pm("a", "applicant"), pm("b", "matched")])), "a");
  const back = tray.removed[0];
  tray = addMember(tray, back).tray;
  assert.equal(tray.members.find((m) => m.memberId === "a")?.membership, "applicant");
  assert.equal(tray.removed.length, 0);
});

test("adding refuses a duplicate and refuses past the cap", () => {
  const full = trayFromProposal(proposal(Array.from({ length: COHORT_CAP }, (_, i) => pm(`m${i}`, "matched"))));
  assert.equal(trayIsFull(full), true);
  assert.equal(addMember(full, added("extra")).refused, "cap");
  assert.equal(addMember(full, added("m3")).refused, "duplicate");
  const room = removeMember(full, "m0");
  const res = addMember(room, added("extra"));
  assert.equal(res.refused, null);
  assert.equal(res.tray.members.length, COHORT_CAP);
});

test("the run is offered at the head-to-head floor, not below it", () => {
  const empty: Tray = { members: [], removed: [] };
  assert.equal(runVerdict(empty), "empty");
  assert.equal(runVerdict(trayFromProposal(proposal([pm("a", "applicant")]))), "belowMin");
  assert.equal(runVerdict(trayFromProposal(proposal([pm("a", "applicant"), pm("b", "matched")]))), "ok");
});

test("the fresh count follows every edit and turns into an upper bound with a hand-added member", () => {
  let tray = trayFromProposal(proposal([pm("a", "applicant", true), pm("b", "matched"), pm("c", "matched")]));
  assert.deepEqual(freshEstimate(tray), { fresh: 2, reused: 1, upperBound: false });
  tray = removeMember(tray, "b");
  assert.deepEqual(freshEstimate(tray), { fresh: 1, reused: 1, upperBound: false });
  tray = removeMember(tray, "a");
  assert.deepEqual(freshEstimate(tray), { fresh: 1, reused: 0, upperBound: false });
  tray = addMember(tray, added("d")).tray;
  assert.deepEqual(freshEstimate(tray), { fresh: 2, reused: 0, upperBound: true });
});

test("groups follow the membership order and drop empty groups", () => {
  const tray = trayFromProposal(proposal([pm("m", "matched"), pm("a", "applicant")]));
  assert.deepEqual(
    groupByMembership(tray.members).map((g) => [g.membership, g.members.length]),
    [
      ["applicant", 1],
      ["matched", 1],
    ]
  );
});

const row = (over: Partial<PopulationLite>): PopulationLite => ({
  key: "k",
  source: "analysis",
  slug: "s",
  id: null,
  name: "Name",
  seniority: null,
  analyses: [],
  ...over,
});

test("a population row without an analysed CV cannot be added", () => {
  assert.equal(memberFromPopulation(row({ slug: null, source: "profile", id: "p1" })), null);
  const m = memberFromPopulation(row({ slug: "an-1", name: "Eva" }));
  assert.equal(m?.memberId, "an-1");
  assert.equal(m?.membership, "added");
  assert.equal(m?.reuseKnown, false);
});

test("the population offer hides anyone already on the tray under any of their ids", () => {
  const tray = trayFromProposal(proposal([pm("an-1", "applicant"), pm("profile:p2", "matched"), pm("an-old", "matched")]));
  const offer = populationOffer(
    [
      row({ key: "1", slug: "an-1" }),
      row({ key: "2", slug: "an-2", source: "profile", id: "p2" }),
      row({ key: "3", slug: "an-3", analyses: [{ slug: "an-old" }] }),
      row({ key: "4", slug: null, source: "profile", id: "p4" }),
      row({ key: "5", slug: "an-5", name: "Zora Malá" }),
      row({ key: "6", slug: "an-6", name: "Petr" }),
    ],
    tray,
    "zor"
  );
  assert.deepEqual(offer.map((r) => r.key), ["5"]);
});

test("the run request carries the tray in order; the retry repeats the cohort", () => {
  const tray = trayFromProposal(proposal([pm("a", "applicant"), pm("b", "matched")]));
  assert.deepEqual(runRequest("jd", tray, { blind: true, reportLang: "cs" }), {
    jdSlug: "jd",
    members: [
      { memberId: "a", membership: "applicant" },
      { memberId: "b", membership: "matched" },
    ],
    blind: true,
    reportLang: "cs",
  });
  const view = {
    jdSlug: "jd",
    blind: false,
    reportLang: "de",
    members: [{ memberId: "x", membership: "added" }],
  } as unknown as CohortView;
  assert.deepEqual(retryRequest(view), { jdSlug: "jd", members: [{ memberId: "x", membership: "added" }], blind: false, reportLang: "de" });
});
