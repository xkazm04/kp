import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDraft, classifyExtract, classifySave, draftSourceKey } from "./importOutcome";

// One assertion per SHAPE the three doors can answer with, because the whole
// point of the module is that these shapes stopped being interchangeable: the
// scanned PDF (200 with no text) must not read as the unreadable file (a coded
// 4xx), and neither may read as the server being unreachable (no JSON at all).

test("extract: text on a 200 is the happy path", () => {
  const out = classifyExtract({ ok: true }, { text: "  Jana N.\nReact  " });
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.text, "  Jana N.\nReact  ");
});

test("extract: a 200 with empty text is a scan, not an unreadable file", () => {
  assert.deepEqual(classifyExtract({ ok: true }, { text: "" }), {
    ok: false,
    stage: "extracting",
    reason: "noTextLayer",
    code: null,
  });
  // Whitespace-only is the same loss, and so is a 200 that carried no `text` at all.
  const blank = classifyExtract({ ok: true }, { text: "  \n " });
  assert.equal(blank.ok === false && blank.reason, "noTextLayer");
  const absent = classifyExtract({ ok: true }, {});
  assert.equal(absent.ok === false && absent.reason, "noTextLayer");
});

test("extract: a coded refusal carries its code for the reader's own language", () => {
  assert.deepEqual(classifyExtract({ ok: false }, { error: "unreadable", code: "EXTRACT_TEXT_UNREADABLE" } as never), {
    ok: false,
    stage: "extracting",
    reason: "coded",
    code: "EXTRACT_TEXT_UNREADABLE",
  });
});

test("extract: a non-JSON body is a transport fault, never a verdict on the file", () => {
  assert.deepEqual(classifyExtract({ ok: false }, null), { ok: false, stage: "extracting", reason: "transport", code: null });
  // A 200 whose body did not parse is the same fault: nothing the server said arrived.
  assert.deepEqual(classifyExtract({ ok: true }, null), { ok: false, stage: "extracting", reason: "transport", code: null });
});

test("extract: a failure with no code is `unknown`, not a fabricated code", () => {
  assert.deepEqual(classifyExtract({ ok: false }, { error: "boom" } as never), {
    ok: false,
    stage: "extracting",
    reason: "unknown",
    code: null,
  });
  // An empty-string code is no code.
  const blankCode = classifyExtract({ ok: false }, { code: "  " } as never);
  assert.equal(blankCode.ok === false && blankCode.reason, "unknown");
});

test("draft: the source rides along, and an absent source claims nothing", () => {
  const det = classifyDraft({ ok: true }, { profile: { displayName: "Jana" }, source: "deterministic" });
  assert.equal(det.ok && det.source, "deterministic");
  const llm = classifyDraft({ ok: true }, { profile: {}, source: "llm" });
  assert.equal(llm.ok && llm.source, "llm");
  const silent = classifyDraft({ ok: true }, { profile: {} });
  assert.equal(silent.ok && silent.source, null);
  const junk = classifyDraft({ ok: true }, { profile: {}, source: "gemini" });
  assert.equal(junk.ok && junk.source, null);
});

test("draft: a 200 with no profile is unknown; a coded 4xx keeps its code", () => {
  assert.deepEqual(classifyDraft({ ok: true }, { source: "llm" }), { ok: false, stage: "drafting", reason: "unknown", code: null });
  assert.deepEqual(classifyDraft({ ok: false }, { code: "PROFILE_DRAFT_FAILED" }), {
    ok: false,
    stage: "drafting",
    reason: "coded",
    code: "PROFILE_DRAFT_FAILED",
  });
  assert.deepEqual(classifyDraft({ ok: false }, null), { ok: false, stage: "drafting", reason: "transport", code: null });
});

test("save: the stored row must carry an id", () => {
  const ok = classifySave({ ok: true }, { id: "p1" });
  assert.equal(ok.ok && ok.profile.id, "p1");
  assert.deepEqual(classifySave({ ok: true }, {}), { ok: false, stage: "saving", reason: "unknown", code: null });
  assert.deepEqual(classifySave({ ok: false }, { code: "JOBSEEKER_STORE_FAILED" }), {
    ok: false,
    stage: "saving",
    reason: "coded",
    code: "JOBSEEKER_STORE_FAILED",
  });
  assert.deepEqual(classifySave({ ok: false }, null), { ok: false, stage: "saving", reason: "transport", code: null });
});

test("the disclosure is remembered per profile, so two profiles cannot share a note", () => {
  assert.equal(draftSourceKey("p1"), "kp-me-draft-source:p1");
  assert.notEqual(draftSourceKey("p1"), draftSourceKey("p2"));
});
