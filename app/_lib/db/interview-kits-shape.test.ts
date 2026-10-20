// A KIT ROW HOLDS NO CANDIDATE DATA. Not a convention — a boundary, checked here.
//
// WHY IT MATTERS MORE THAN IT LOOKS. The GDPR erasure path in this product is entry-keyed:
// `scrubEntryLinkedPii` (db/pipeline.ts) walks ONE pipeline entry's preps, interviews,
// events, recordings and offers and blanks them. `interview_kits` is JOB-keyed, so the
// scrub has no path to it at all — there is no entry to walk from. Anything about a
// person that reached a kit row would therefore be undeletable by design, and an erasure
// this product told a candidate it had performed would be a false statement.
//
// Two halves, because the row has two surfaces:
//   1. the TABLE — no column may name a person, so the shape cannot invite one;
//   2. the PAYLOAD — the kit JSON is authored by a human in a browser and by a language
//      model, and both can paste a name. The normalizer is the only way in, and it emits
//      exactly the contract's keys, so a pasted `candidateName` never reaches the column.
//
// The per-candidate material this table deliberately does NOT carry lives in
// `interview_preps`, which the scrub does blank, and in the `KitOverlay` on that prep.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { ensureDb } = await import("./core.ts");
const { interviewKitAppendVersion, interviewKitById } = await import("./interview-kits.ts");
const { normalizeInterviewKit } = await import("../interview-kit-validate.ts");

after(() => cleanupUnitDb());

/** Words that would mark a column (or a payload key) as carrying a person rather than a
 *  role. Deliberately broad: the point is that NOTHING here is about an individual, so a
 *  near-miss is worth a failing test and a conversation. */
const PERSON_WORDS = [
  "candidate",
  "applicant",
  "entry_id",
  "entryid",
  "profile",
  "person",
  "email",
  "phone",
  "cv",
  "resume",
  "name",
];

test("no column of interview_kits names a person", () => {
  const columns = (ensureDb().prepare(`PRAGMA table_info(interview_kits)`).all() as { name: string }[]).map((c) =>
    c.name.toLowerCase()
  );
  assert.ok(columns.length > 0, "the table must exist — did the DDL move?");
  for (const column of columns) {
    for (const word of PERSON_WORDS) {
      assert.equal(
        column.includes(word),
        false,
        `interview_kits.${column} reads as candidate data. The erasure scrub is entry-keyed and cannot reach a ` +
          `job-keyed row, so this column would be undeletable — put per-candidate material on interview_preps.`
      );
    }
  }
  // …and the columns that ARE here are the job-keyed, versioned set the DDL declares.
  assert.deepEqual(
    columns.sort(),
    ["created_at", "id", "job_id", "kit_json", "source", "status", "version", "workspace_id"],
    "the kit row's whole vocabulary is the role, the version and the payload"
  );
});

test("the persisted payload carries only the contract's own keys — a pasted candidate field never lands", () => {
  // A recruiter pastes a candidate's name into the editor, and a model echoes a CV field
  // back into its answer. Both arrive as extra keys; the normalizer is the only door.
  const hostile = {
    version: 1,
    candidateName: "Jana Nováková",
    competencies: [
      {
        id: "c1",
        title: "Service ownership",
        weight: 3,
        budgetMin: 10,
        candidateId: "cand-1",
        questions: [{ id: "c1q1", text: "What did you own?", mustAsk: true, sourceCv: "jana.pdf" }],
      },
    ],
    faq: [{ id: "f1", question: "Remote?", answer: "Two days a week.", askedBy: "jana@example.com" }],
    note: "Tone: conversational.",
  };
  const normalized = normalizeInterviewKit(hostile);
  assert.equal(normalized.ok, true);
  if (!normalized.ok) throw new Error("unreachable");

  const saved = interviewKitAppendVersion({ jobId: "shape-job", kit: normalized.kit, source: "edited" });
  const row = ensureDb().prepare(`SELECT kit_json FROM interview_kits WHERE id = ?`).get(saved.id) as { kit_json: string };

  // The check runs over the STORED BYTES, not the in-memory object: what a future reader
  // (or an export, or a support dump) gets is the column, and that is what must be clean.
  const keys = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== "object") return;
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      walk(v);
    }
  };
  walk(JSON.parse(row.kit_json));
  assert.deepEqual(
    [...keys].sort(),
    ["budgetMin", "competencies", "faq", "id", "mustAsk", "note", "question", "questions", "text", "title", "version", "weight", "answer"].sort(),
    "the stored kit must be exactly the InterviewKit contract — no key the normalizer did not emit"
  );
  for (const key of keys) {
    for (const word of PERSON_WORDS) {
      // `name` would catch nothing legitimate here; `question`/`answer` are role facts.
      assert.equal(key.toLowerCase().includes(word), false, `the stored kit carries a person-shaped key: ${key}`);
    }
  }
  assert.equal(row.kit_json.includes("Nováková"), false, "a pasted candidate name must not reach the column");
  assert.equal(row.kit_json.includes("jana@example.com"), false, "…nor a pasted address");

  // And the read path returns the same clean object.
  const readBack = interviewKitById(saved.id);
  assert.ok(readBack);
  assert.equal(JSON.stringify(readBack.kit).includes("cand-1"), false);
});
