// The per-entry note THREAD (db/entry-notes.ts) — an additive, append-only list of
// authored notes beside the pipeline_entries.notes scratchpad. Drives the REAL db against
// a throwaway file. Proves: append + list, the author comes from the SESSION and never
// the body, a null session user is stored NULL, the bounds, workspace isolation both
// ways, the author name resolving at READ time, and the route staying a thin pass.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import "better-sqlite3";

const ROOT = new URL("../../../", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href;
    else if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href;
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + fs.readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kp-entry-notes-"));
process.env.KP_DB_PATH = path.join(TMP_DIR, "kp.sqlite");
delete process.env.DATABASE_URL;

const { createPipelineEntry } = await import("./pipeline.ts");
const { appendEntryNoteFromBody, listEntryNotes, MAX_NOTES_LENGTH } = await import("./entry-notes.ts");
const { createUser, updateUserName } = await import("./users.ts");
const { ensureDb } = await import("./core.ts");

after(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* file locked — the unique dir means a leftover can never poison a later run */
  }
});

let seq = 0;
function entryIn(workspaceId?: string) {
  seq += 1;
  const { entry } = createPipelineEntry(
    { candidateId: `c-note-${seq}`, candidateLabel: `Candidate ${seq}`, jobId: `job-note-${seq}`, jobTitle: "Engineer", stage: "Screened", workspaceId }
  );
  return entry;
}

test("append then list: oldest first (newest last), trimmed", () => {
  const e = entryIn();
  const a = appendEntryNoteFromBody(e.id, "workspace", "  first call went well  ", null);
  const b = appendEntryNoteFromBody(e.id, "workspace", "second", null);
  assert.ok(a.ok && b.ok);
  assert.deepEqual(
    listEntryNotes(e.id, "workspace").map((n) => n.body),
    ["first call went well", "second"]
  );
});

test("a null session user (no-auth mode) is stored as NULL, never a placeholder", () => {
  const e = entryIn();
  appendEntryNoteFromBody(e.id, "workspace", "local note", null);
  const [n] = listEntryNotes(e.id, "workspace");
  assert.equal(n.authorUserId, null);
  assert.equal(n.authorName, null);
  const raw = ensureDb().prepare(`SELECT author_user_id FROM pipeline_entry_notes WHERE entry_id = ?`).get(e.id) as {
    author_user_id: string | null;
  };
  assert.equal(raw.author_user_id, null);
});

test("the author is the SESSION's user id; nothing in the request can set it", () => {
  const e = entryIn();
  const u = createUser({ orgId: "org-notes", email: "recruiter@example.com", name: "Petra" });
  // The last argument is the whole identity surface; a body that carries an author is
  // not a parameter of this function at all.
  const res = appendEntryNoteFromBody(e.id, "workspace", "mine", u.id);
  assert.ok(res.ok);
  assert.equal(listEntryNotes(e.id, "workspace")[0].authorUserId, u.id);
  const src = fs.readFileSync(fileURLToPath(new URL("../../api/pipeline/[id]/route.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const branch = src.slice(src.indexOf('action === "add_note"'), src.indexOf('action === "reinstate"'));
  assert.ok(branch.length > 50, "the add_note branch is found");
  assert.match(branch, /currentUser\(\)/, "the route stamps the author from the session");
  assert.doesNotMatch(branch, /body\.(author|authorId|authorUserId|userId)/, "no author field is read from the body");
});

test("the display name resolves at READ time: a rename shows the current name", () => {
  const e = entryIn();
  const u = createUser({ orgId: "org-notes", email: "rename@example.com", name: "Old Name" });
  appendEntryNoteFromBody(e.id, "workspace", "hello", u.id);
  assert.equal(listEntryNotes(e.id, "workspace")[0].authorName, "Old Name");
  updateUserName(u.id, "New Name");
  assert.equal(listEntryNotes(e.id, "workspace")[0].authorName, "New Name");
  const cols = ensureDb().prepare(`PRAGMA table_info(pipeline_entry_notes)`).all() as { name: string }[];
  assert.ok(!cols.some((c) => /name|label/i.test(c.name)), "no display name is copied into the row");
});

test("bounds: empty and non-string are 400; over the cap is 400 with the cap as data", () => {
  const e = entryIn();
  const empty = appendEntryNoteFromBody(e.id, "workspace", "   ", null);
  assert.ok(!empty.ok);
  assert.equal(empty.status, 400);
  assert.equal(empty.code, "PIPELINE_NOTE_EMPTY");
  const bad = appendEntryNoteFromBody(e.id, "workspace", 42, null);
  assert.ok(!bad.ok);
  assert.equal(bad.status, 400);
  assert.equal(bad.code, "PIPELINE_NOTES_INVALID");
  const long = appendEntryNoteFromBody(e.id, "workspace", "x".repeat(MAX_NOTES_LENGTH + 1), null);
  assert.ok(!long.ok);
  assert.equal(long.status, 400);
  assert.equal(long.code, "PIPELINE_NOTES_TOO_LONG");
  assert.deepEqual(long.data, { max: MAX_NOTES_LENGTH, length: MAX_NOTES_LENGTH + 1 });
  assert.equal(listEntryNotes(e.id, "workspace").length, 0, "refusals write nothing");
  assert.ok(appendEntryNoteFromBody(e.id, "workspace", "x".repeat(MAX_NOTES_LENGTH), null).ok, "exactly the cap is accepted");
});

test("workspace isolation: another team can neither list nor append to this entry", () => {
  const e = entryIn();
  appendEntryNoteFromBody(e.id, "workspace", "ours", null);
  assert.deepEqual(listEntryNotes(e.id, "other-team"), [], "another workspace lists nothing");
  const res = appendEntryNoteFromBody(e.id, "other-team", "intruder", null);
  assert.ok(!res.ok);
  assert.equal(res.status, 404);
  assert.equal(res.code, "PIPELINE_ENTRY_NOT_FOUND");
  assert.deepEqual(
    listEntryNotes(e.id, "workspace").map((n) => n.body),
    ["ours"],
    "nothing landed"
  );
  const rows = ensureDb().prepare(`SELECT workspace_id FROM pipeline_entry_notes WHERE entry_id = ?`).all(e.id) as { workspace_id: string }[];
  assert.deepEqual(
    rows.map((r) => r.workspace_id),
    ["workspace"],
    "the row's tenant is derived from the entry"
  );
  // The mirror: a note on another team's own entry is invisible here.
  const theirs = entryIn("other-team");
  appendEntryNoteFromBody(theirs.id, "other-team", "theirs", null);
  assert.deepEqual(listEntryNotes(theirs.id, "workspace"), []);
  assert.equal(listEntryNotes(theirs.id, "other-team").length, 1);
});

test("an unknown entry is a 404, not a dangling row", () => {
  const res = appendEntryNoteFromBody("no-such-entry", "workspace", "x", null);
  assert.ok(!res.ok);
  assert.equal(res.status, 404);
});
