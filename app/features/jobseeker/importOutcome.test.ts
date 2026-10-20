import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDraft, classifyExtract, classifyRecorded, classifyReuse, classifySave, draftSourceKey, importCv, type ImportPost } from "./importOutcome";

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

// ── importCv: which doors an import knocks on ──────────────────────────────────
//
// The proof that a CV already read costs no model call is here, where the calls are
// made: a fake `post` records every URL, and on a reuse hit /api/profile/draft is
// never among them.

type Call = { url: string; body: unknown };
function fakePost(answers: Record<string, { ok: boolean; body: Record<string, unknown> | null }>) {
  const calls: Call[] = [];
  const post: ImportPost = async (url, init) => {
    calls.push({ url, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
    const a = answers[url];
    if (!a) throw new Error(`unexpected door ${url}`);
    return { res: { ok: a.ok }, body: a.body };
  };
  return { post, calls, urls: () => calls.map((c) => c.url) };
}

const cvRow = { id: "jscv-1", fileName: "ada.pdf", byteSize: 10, draftSource: "llm", createdAt: "2026-09-01T10:00:00.000Z", lastUsedAt: "2026-09-26T10:00:00.000Z", active: true };
const file = new Blob(["Ada Lovelace"], { type: "text/plain" });

test("importCv: a CV read before is reused — the draft door is never called", async () => {
  const { post, urls } = fakePost({
    "/api/extract-text": { ok: true, body: { text: "Ada Lovelace" } },
    "/api/jobseeker/cvs/reuse": { ok: true, body: { reused: true, profile: { id: "jsp-1" }, cv: cvRow } },
  });
  const stages: string[] = [];
  const out = await importCv(file, { post, fileName: "ada.pdf", onStage: (s) => stages.push(s) });
  assert.equal(out.ok, true);
  assert.ok(out.ok && out.reused);
  assert.equal(out.ok && out.source, "llm", "the stored reader is what the page discloses");
  assert.equal(out.ok && out.cv?.id, "jscv-1");
  assert.deepEqual(urls(), ["/api/extract-text", "/api/jobseeker/cvs/reuse"]);
  assert.ok(!urls().includes("/api/profile/draft"));
  assert.deepEqual(stages, ["extracting", "drafting"]);
});

test("importCv: a new CV is drafted, then recorded with its reader, file name and size", async () => {
  const { post, calls, urls } = fakePost({
    "/api/extract-text": { ok: true, body: { text: "Grace Hopper" } },
    "/api/jobseeker/cvs/reuse": { ok: true, body: { reused: false } },
    "/api/profile/draft": { ok: true, body: { profile: { displayName: "Grace" }, source: "deterministic" } },
    "/api/jobseeker/cvs": { ok: true, body: { profile: { id: "jsp-1" }, cv: { ...cvRow, id: "jscv-2", draftSource: "deterministic" } } },
  });
  const out = await importCv(file, { post, fileName: "grace.pdf" });
  assert.ok(out.ok && !out.reused);
  assert.equal(out.ok && out.source, "deterministic");
  assert.deepEqual(urls(), ["/api/extract-text", "/api/jobseeker/cvs/reuse", "/api/profile/draft", "/api/jobseeker/cvs"]);
  assert.deepEqual(calls[3]!.body, { text: "Grace Hopper", profile: { displayName: "Grace" }, draftSource: "deterministic", fileName: "grace.pdf", byteSize: file.size });
});

test("importCv: 'Read it again' skips the reuse check and drafts anew", async () => {
  const { post, urls } = fakePost({
    "/api/extract-text": { ok: true, body: { text: "Ada Lovelace" } },
    "/api/profile/draft": { ok: true, body: { profile: { displayName: "Ada" }, source: "llm" } },
    "/api/jobseeker/cvs": { ok: true, body: { profile: { id: "jsp-1" }, cv: cvRow } },
  });
  const out = await importCv(file, { post, fresh: true });
  assert.ok(out.ok && !out.reused);
  assert.deepEqual(urls(), ["/api/extract-text", "/api/profile/draft", "/api/jobseeker/cvs"]);
});

test("importCv: a failed reuse check degrades to a normal read, never blocks the import", async () => {
  const { post, urls } = fakePost({
    "/api/extract-text": { ok: true, body: { text: "Ada Lovelace" } },
    "/api/jobseeker/cvs/reuse": { ok: false, body: { code: "TOO_MANY_REQUESTS" } },
    "/api/profile/draft": { ok: true, body: { profile: { displayName: "Ada" }, source: "llm" } },
    "/api/jobseeker/cvs": { ok: true, body: { profile: { id: "jsp-1" }, cv: cvRow } },
  });
  const out = await importCv(file, { post });
  assert.equal(out.ok, true);
  assert.ok(urls().includes("/api/profile/draft"));
});

test("importCv: each hop's failure stops the import at that hop, classified", async () => {
  const unreadable = await importCv(file, { post: fakePost({ "/api/extract-text": { ok: false, body: { code: "EXTRACT_TEXT_UNREADABLE" } } }).post });
  assert.deepEqual(unreadable, { ok: false, stage: "extracting", reason: "coded", code: "EXTRACT_TEXT_UNREADABLE" });
  const draftDown = fakePost({
    "/api/extract-text": { ok: true, body: { text: "x" } },
    "/api/jobseeker/cvs/reuse": { ok: true, body: { reused: false } },
    "/api/profile/draft": { ok: false, body: null },
  });
  assert.deepEqual(await importCv(file, { post: draftDown.post }), { ok: false, stage: "drafting", reason: "transport", code: null });
  assert.ok(!draftDown.urls().includes("/api/jobseeker/cvs"), "nothing is recorded when the draft failed");
  const storeDown = fakePost({
    "/api/extract-text": { ok: true, body: { text: "x" } },
    "/api/jobseeker/cvs/reuse": { ok: true, body: { reused: false } },
    "/api/profile/draft": { ok: true, body: { profile: {}, source: "llm" } },
    "/api/jobseeker/cvs": { ok: false, body: { code: "JOBSEEKER_STORE_FAILED" } },
  });
  assert.deepEqual(await importCv(file, { post: storeDown.post }), { ok: false, stage: "saving", reason: "coded", code: "JOBSEEKER_STORE_FAILED" });
});

test("reuse / record classifiers: a malformed success is not a success", () => {
  assert.equal(classifyReuse({ ok: true }, { reused: true, profile: { id: "p" } }), null, "no cv row, no claim of reuse");
  assert.equal(classifyReuse({ ok: true }, { reused: false }), null);
  assert.equal(classifyReuse({ ok: false }, null), null);
  assert.deepEqual(classifyRecorded({ ok: true }, { cv: cvRow }), { ok: false, stage: "saving", reason: "unknown", code: null });
  const ok = classifyRecorded({ ok: true }, { profile: { id: "p" }, cv: { junk: 1 } });
  assert.ok(ok.ok && ok.cv === null, "a missing cv row is tolerated; the profile is what was saved");
});
