// The client MIRROR of the kit-overlay rules, pinned against the server rules it mirrors
// (spark interview-kit-template, WP-C).
//
// interview-kit-overlay.ts restates four things the agenda owns — the probe id, how an
// overlay rewrites the kit, which of a candidate's probes ride the interview, and how a
// stored overlay is narrowed — because the modal is a client component and the real ones
// live in modules that import the database. A mirror that drifts would make the prep modal
// promise questions the interview does not ask, so every rule is run here against the real
// function over the same inputs, and once end to end through buildInterviewKit.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry } from "./db/pipeline.ts";
import { interviewKitAppendVersion } from "./db/interview-kits.ts";
import { saveInterviewPrep } from "./interview-prep.ts";
import { insertJob } from "./job-ingest.ts";
import { buildRunOfShow } from "./run-of-show.ts";
import { interviewBriefStrings, rosStrings } from "./interview-prep-strings.ts";
import {
  applyKitOverlay,
  buildInterviewKit,
  cvProbeId,
  MAX_KIT_CV_PROBES,
  MAX_OVERLAY_ADDED_QUESTIONS,
  type InterviewKit as AgendaKit,
} from "./interview-agenda.ts";
import { coerceKitOverlay } from "./interview-kit.ts";
import {
  applyOverlayToKit,
  askedCandidateProbes,
  candidateProbeTexts,
  kitAskedTexts,
  kitOverlayProblems,
  kitProbeId,
  narrowKitOverlay,
  KIT_OVERLAY_CV_PROBES_ASKED,
  KIT_OVERLAY_MAX_ADDED,
  KIT_OVERLAY_MAX_REFS,
} from "./interview-kit-overlay.ts";
import { composeOverlayView } from "../features/hiring/schedule/scheduleInterviewPrepOverlayModel.ts";
import { EMPTY_KIT_OVERLAY, KIT_MAX_MUST_ASKS, type InterviewKit, type KitOverlay } from "./interview-kit-types.ts";

after(() => cleanupUnitDb());

const KIT: InterviewKit = {
  version: 1,
  competencies: [
    {
      id: "c-strategy",
      title: "Test strategy",
      weight: 3,
      budgetMin: 6,
      questions: [
        { id: "q-first", text: "How do you decide what to automate first?", mustAsk: true },
        { id: "q-healthy", text: "What does a healthy suite look like to you?", mustAsk: false, followUp: "And an unhealthy one?" },
      ],
    },
    {
      id: "c-collab",
      title: "Collaboration",
      weight: 1,
      budgetMin: 4,
      questions: [{ id: "q-disagree", text: "Tell me about a disagreement with a developer.", mustAsk: false }],
    },
  ],
  faq: [],
};

const ov = (o: Partial<KitOverlay>): KitOverlay => ({ ...EMPTY_KIT_OVERLAY, ...o });

test("the mirrored caps are the agenda's own numbers", () => {
  assert.equal(KIT_OVERLAY_MAX_ADDED, MAX_OVERLAY_ADDED_QUESTIONS);
  assert.equal(KIT_OVERLAY_CV_PROBES_ASKED, MAX_KIT_CV_PROBES);
});

test("kitProbeId mints exactly the id the agenda's cvProbeId looks for", () => {
  const texts = [
    "Which tests would you write first?",
    "   padded with spaces   ",
    "Jak byste otestovali platební bránu? Přílišné ověřování?",
    "Emoji \u{1F680} and CJK 测试",
    "",
    "a",
  ];
  for (const t of texts) assert.equal(kitProbeId(t), cvProbeId(t), JSON.stringify(t));
});

test("applyOverlayToKit is applyKitOverlay, operation by operation", () => {
  const cases: KitOverlay[] = [
    EMPTY_KIT_OVERLAY,
    ov({ dropped: ["q-first"] }),
    ov({ edited: [{ id: "q-healthy", text: "What does a flaky suite cost you?" }] }),
    ov({ edited: [{ id: "q-healthy", text: "   " }] }),
    ov({ added: [{ id: "ov-1", competencyId: "c-collab", text: "Who do you pair with most?", mustAsk: true }] }),
    ov({ added: [{ id: "ov-2", competencyId: null, text: "What is your notice period?", mustAsk: false }] }),
    ov({ added: [{ id: "ov-3", competencyId: "c-gone", text: "Orphaned competency?", mustAsk: false }] }),
    ov({ added: [{ id: "ov-4", competencyId: null, text: "  ", mustAsk: false }] }),
    ov({ dropped: ["ov-5"], added: [{ id: "ov-5", competencyId: null, text: "Dropped addition", mustAsk: false }] }),
    ov({
      added: Array.from({ length: KIT_OVERLAY_MAX_ADDED + 2 }, (_, i) => ({ id: `ov-many-${i}`, competencyId: null, text: `Extra ${i}?`, mustAsk: false })),
    }),
    ov({ dropped: ["q-disagree", "not-in-this-version"], edited: [{ id: "also-gone", text: "x" }] }),
  ];
  for (const o of cases) {
    assert.deepEqual(applyOverlayToKit(KIT, o, "Added"), applyKitOverlay(KIT, o, "Added"), JSON.stringify(o));
  }
});

test("narrowKitOverlay keeps what coerceKitOverlay keeps, and the kit it yields is the same", () => {
  const inputs: unknown[] = [
    null,
    "nope",
    { version: 2, dropped: ["q-first"] },
    { version: 1 },
    { version: 1, dropped: ["q-first", 7, null], edited: [{ id: "q-healthy", text: "Rewritten?" }, { id: 3 }], added: [{ id: "a", text: "Q?", mustAsk: true, competencyId: "c-collab", extra: "x" }, { text: "no id" }] },
    { version: 1, dropped: "q-first", edited: {}, added: null },
  ];
  for (const input of inputs) {
    const server = coerceKitOverlay(input);
    const client = narrowKitOverlay(input);
    assert.deepEqual(client.dropped, server.dropped);
    assert.deepEqual(client.edited, server.edited.map((e) => ({ id: e.id, text: e.text })));
    assert.deepEqual(
      client.added.map((a) => [a.id, a.text, a.mustAsk]),
      server.added.map((a) => [a.id, a.text, a.mustAsk === true])
    );
    assert.deepEqual(applyOverlayToKit(KIT, client, "Added"), applyKitOverlay(KIT, server, "Added"), JSON.stringify(input));
  }
});

test("kitOverlayProblems: every cap the write door refuses is caught before a save", () => {
  assert.deepEqual(kitOverlayProblems(EMPTY_KIT_OVERLAY), []);
  const added = (n: number, mustAsk = false) =>
    Array.from({ length: n }, (_, i) => ({ id: `ov-${i}`, competencyId: null, text: `Q${i}?`, mustAsk }));
  assert.deepEqual(kitOverlayProblems(ov({ added: added(KIT_OVERLAY_MAX_ADDED) })), []);
  assert.ok(kitOverlayProblems(ov({ added: added(KIT_OVERLAY_MAX_ADDED + 1) })).includes("too_many_added"));
  assert.ok(
    kitOverlayProblems(ov({ dropped: Array.from({ length: KIT_OVERLAY_MAX_REFS + 1 }, (_, i) => `d-${i}`) })).includes("too_many_refs")
  );
  // The must-ask budget is KIT-wide: additions spend what the kit's own must-asks leave.
  assert.deepEqual(kitOverlayProblems(ov({ added: added(2, true) }), KIT_MAX_MUST_ASKS - 2), []);
  assert.ok(kitOverlayProblems(ov({ added: added(2, true) }), KIT_MAX_MUST_ASKS - 1).includes("too_many_must_asks"));
  assert.ok(kitOverlayProblems(ov({ edited: [{ id: "q-first", text: "  " }] })).includes("text_empty"));
  assert.ok(kitOverlayProblems(ov({ added: [{ id: "a", competencyId: null, text: "x".repeat(601), mustAsk: false }] })).includes("text_too_long"));
  assert.ok(kitOverlayProblems(ov({ dropped: [""] })).includes("id_invalid"));
  assert.ok(kitOverlayProblems(ov({ dropped: ["x".repeat(65)] })).includes("id_invalid"));
  assert.ok(kitOverlayProblems(ov({ dropped: ["q-first", "q-first"] })).includes("id_duplicate"));
  assert.ok(
    kitOverlayProblems(ov({ dropped: ["ov-0"], added: [{ id: "ov-0", competencyId: null, text: "Q?", mustAsk: false }] })).includes("id_duplicate"),
    "an addition may not share an id with a drop — the two would argue about one question"
  );
});

// ---- end to end: what the modal says will be asked IS what the agenda asks -------------

let seq = 0;

async function prepEntryWithKit(overlay: KitOverlay, imported: string[] = []) {
  const n = ++seq;
  const jobId = insertJob(
    { id: `job-overlay-${n}`, title: "QA Engineer", company: "Acme", location: "Praha", workMode: "hybrid", description: "QA." },
    undefined,
    "published"
  ).id;
  const { entry } = createPipelineEntry({ candidateId: `cand-ov-${n}`, candidateLabel: `Kandidat ${n}`, jobId, jobTitle: "QA Engineer", locale: "en" });
  const qs = [
    // One probe the kit already asks (must be de-duplicated away), and four of its own.
    { competency: "Strategy", question: "How do you decide what to automate first?", whatsGoodLooksLike: "risk", followUpIfAnswer: "What would you leave untested?" },
    { competency: "Depth", question: "Walk me through your flakiest test.", whatsGoodLooksLike: "root cause" },
    { competency: "Tooling", question: "Which runner did you replace, and why?", whatsGoodLooksLike: "trade-offs" },
    { competency: "Scale", question: "How long did your suite take at its worst?", whatsGoodLooksLike: "numbers" },
  ];
  const plan = buildRunOfShow(qs, ["automation"], entry.candidateLabel ?? null, "QA Engineer", await rosStrings("en"));
  const payload = { ...plan, lang: "en", importedQuestions: imported, kitOverlay: overlay };
  saveInterviewPrep(entry.id, entry.candidateLabel ?? null, "QA Engineer", payload);
  const kitId = interviewKitAppendVersion({ jobId, kit: KIT, source: "edited", status: "published" }).id;
  return { entryId: entry.id, kitId, payload };
}

async function agendaProbes(entryId: string, kitId: string): Promise<string[]> {
  const s = await interviewBriefStrings("en");
  const built = (await buildInterviewKit(entryId, undefined, { kitId, bookedMin: 40 })) as AgendaKit;
  // The per-candidate block is the LAST block titled like it (a loose-addition block, when
  // there is one, carries the same catalog title and comes before it).
  const blocks = built.agenda.blocks.filter((b) => b.title === s.recruiterAddedQuestions && b.competency === "Per-candidate probes");
  return blocks.at(-1)?.questions ?? [];
}

async function agendaKitQuestions(entryId: string, kitId: string): Promise<string[][]> {
  const built = (await buildInterviewKit(entryId, undefined, { kitId, bookedMin: 40 })) as AgendaKit;
  return built.agenda.blocks.filter((b) => b.mustAsks !== undefined || b.weight !== undefined).map((b) => b.questions);
}

const modalAsked = (payload: { chronology?: unknown; importedQuestions?: unknown }, overlay: KitOverlay) => {
  const view = composeOverlayView(KIT, payload, overlay, { cvProbesRide: true });
  return {
    probes: view.groups.find((g) => g.kind === "cv")?.rows.filter((r) => r.asked).map((r) => r.text.trim()) ?? [],
    kit: view.groups.filter((g) => g.kind !== "cv").map((g) => g.rows.filter((r) => r.asked).map((r) => r.text.trim())),
  };
};

test("end to end: with no overlay, the modal's asked probes are the agenda's probe block", async () => {
  const { entryId, kitId, payload } = await prepEntryWithKit(EMPTY_KIT_OVERLAY, ["What did you ship last quarter?"]);
  const agenda = await agendaProbes(entryId, kitId);
  const mirrored = askedCandidateProbes(candidateProbeTexts(payload, kitAskedTexts(applyOverlayToKit(KIT, EMPTY_KIT_OVERLAY, ""))), EMPTY_KIT_OVERLAY);
  assert.equal(agenda.length, KIT_OVERLAY_CV_PROBES_ASKED, "the cap binds — this fixture has more probes than ride");
  assert.deepEqual(mirrored, agenda);
  assert.deepEqual(modalAsked(payload, EMPTY_KIT_OVERLAY).probes, agenda);
  assert.equal(agenda[0], "What did you ship last quarter?", "the recruiter's own import comes first");
  assert.ok(!agenda.includes("How do you decide what to automate first?"), "a probe the kit already asks is not asked twice");
});

test("end to end: drops and rewrites of CV probes move the cap exactly as the agenda does", async () => {
  // Build once to learn the probe ids, then write the overlay against them — the modal's
  // real sequence.
  const probe = (t: string) => kitProbeId(t);
  const overlay = ov({
    dropped: [probe("What did you ship last quarter?"), "q-disagree"],
    edited: [
      { id: probe("Walk me through your flakiest test."), text: "Walk me through the flakiest test you fixed." },
      { id: "q-healthy", text: "What does a suite you trust look like?" },
    ],
    added: [
      { id: "ov-a", competencyId: "c-collab", text: "Who do you pair with most?", mustAsk: false },
      { id: "ov-b", competencyId: null, text: "What is your notice period?", mustAsk: false },
    ],
  });
  const { entryId, kitId, payload } = await prepEntryWithKit(overlay, ["What did you ship last quarter?"]);
  const agenda = await agendaProbes(entryId, kitId);
  const shown = modalAsked(payload, overlay);
  assert.deepEqual(shown.probes, agenda, "the CV rows the modal marks as asked are the agenda's probes");
  assert.ok(agenda.includes("Walk me through the flakiest test you fixed."), "the rewrite is asked");
  assert.ok(!agenda.includes("What did you ship last quarter?"), "the dropped import is not");
  // The kit side: the spine the agenda drafts, block by block, is what the modal lists —
  // two competencies plus the trailing block for the loose addition.
  const spine = await agendaKitQuestions(entryId, kitId);
  assert.equal(spine.length, 3);
  assert.deepEqual(shown.kit, spine);
  assert.deepEqual(spine[1], ["Who do you pair with most?"], "the dropped kit question is gone, the addition rides its competency");
});
