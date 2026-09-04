// RESPONSE-ENVELOPE CONTRACT — a ratchet on the raw thrown message reaching a client.
//
// THE LAW, already written down. docs/architecture/api-contracts.md §1.1 names four
// responders in app/_lib/api-response.ts and says which one a handler must pick:
//
//   > `safeJsonError` is what keeps that off the wire; `jsonError` on a store path
//   > is an information-disclosure leak.
//
// api-response.ts says the same at its own definition site: "Use it — not `jsonError`
// — on any catch/500 path that can surface a store error." A thrown better-sqlite3 /
// fs / spawn error carries SQLITE_CORRUPT, `UNIQUE constraint failed: jds.slug`, the
// absolute db path and Python tracebacks in its `.message`.
//
// THE GAP THIS CLOSES. Two guards already enforce that law and both are hand-listed
// arrays of routes: app/api/jds/error-message-hygiene.test.ts pins six JD/template
// handlers, app/api/apply/apply-error-hygiene.test.ts pins two public apply handlers.
// Eight of roughly two hundred. Nothing watched the other ~190, and the scan that
// produced this file found 81 catch blocks across 68 route files still shaping a
// thrown error's own message into a client response body. A new route that leaks
// joins them silently.
//
// That is the shape §1.2 (tenancy) and §1.4 (rate limits) already solved — see
// route-tenancy-coverage.test.ts and rate-limit-contract.test.ts, which walk the whole
// api tree instead of naming files. §1.1 was the only one of the four sections of the
// HTTP contract with no repo-wide guard. This is it, built on the same source-scan
// pattern (route handlers need a request scope the unit runner cannot give them, and
// "the raw message is in the response body" is a property the source states).
//
// WHY A RATCHET AND NOT A WALL. Bulk-rewriting 81 handlers in one pass is an
// unreviewable diff across the least-tested paths, and each one needs a STORE_ERRORS
// code plus four catalogue entries (npm run i18n:check pins that). So the number is a
// ceiling, in the idiom scripts/lint/ts-ratchet.mjs already established here: a file
// not on the list may not leak at all, a listed file may not leak MORE than its
// number, and a file that drops below its number is a note rather than a red build,
// because taxing the fix is how a ratchet gets switched off.
//
// Runner: node:test, via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const apiDir = path.dirname(fileURLToPath(import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, out);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** Mark every byte that sits inside a comment or a string/template literal.
 *
 *  Load-bearing twice over. This codebase documents its own past leaks in prose —
 *  api-response.ts quotes `error instanceof Error ? error.message` in the comment
 *  explaining why safeJsonError exists — so a scan that reads comments reports the
 *  documentation as the defect. And `catch` appears inside the inline theme script
 *  in app/layout.tsx as string content. */
function maskOf(src: string): Uint8Array {
  const mask = new Uint8Array(src.length);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? src.length : nl;
      mask.fill(1, i, end);
      i = end;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i);
      const end = close === -1 ? src.length : close + 2;
      mask.fill(1, i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === q) break;
        j += 1;
      }
      mask.fill(1, i, Math.min(j + 1, src.length));
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return mask;
}

/** The source with comments and string contents blanked, so a regex sees code only. */
function codeOnly(src: string): string {
  const mask = maskOf(src);
  let out = "";
  for (let i = 0; i < src.length; i += 1) out += mask[i] ? " " : src[i];
  return out;
}

/** Calls that ARE doors: the raw message belongs in them. Blanked before the scan.
 *
 *  Without this, the three correct handlers in app/api/schedule/[token]/route.ts were
 *  reported as leaks: each builds `const reason = e instanceof Error ? e.message : …`
 *  and hands it to `logScheduleReconcile({ …, error: reason })` and
 *  `markScheduleInviteNeedsReconcile(token, reason)` — a telemetry door and a store
 *  flag, never the client. The `error:` KEY inside a door call is not a response body,
 *  and a checker that cannot tell them apart teaches people to ignore it. */
const DOOR_CALL =
  /(?:console\s*\.\s*\w+|(?<![\w$.])(?:log[A-Z]\w*|record[A-Z]\w*|mark[A-Z]\w*|alert[A-Z]\w*|capture[A-Z]\w*|report[A-Z]\w*))\s*\(/;

function stripDoorCalls(code: string): string {
  let out = code;
  for (let guard = 0; guard < 400; guard += 1) {
    const m = DOOR_CALL.exec(out);
    if (!m) break;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < out.length; i += 1) {
      if (out[i] === "(") depth += 1;
      else if (out[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out = out.slice(0, m.index) + " ".repeat(i - m.index + 1) + out.slice(i + 1);
  }
  return out;
}

/** The raw thrown value being turned into text. */
const RAW_MESSAGE =
  /instanceof\s+Error\s*\?\s*[A-Za-z_$][\w$]*\s*\.\s*message|[A-Za-z_$][\w$]*\s*\.\s*message\s*(?:\?\?|\|\|)|\bString\s*\(\s*(?:err|error|e)\s*\)/;

/** …and that text heading for a client. */
const CLIENT_BODY = /NextResponse\s*\.\s*json\s*\(|\berror\s*:|\breason\s*:|\bdetail\s*:/;

type Offender = { file: string; line: number };

function offendersIn(files: string[], readSource: (f: string) => string = (f) => readFileSync(f, "utf8")): Offender[] {
  const found: Offender[] = [];
  for (const f of files) {
    const src = readSource(f);
    const mask = maskOf(src);
    const re = /\bcatch\s*(\([^)]*\)\s*)?\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (mask[m.index]) continue;
      const open = m.index + m[0].length - 1;
      let depth = 0;
      let i = open;
      for (; i < src.length; i += 1) {
        if (mask[i]) continue;
        if (src[i] === "{") depth += 1;
        else if (src[i] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const body = stripDoorCalls(codeOnly(src.slice(open + 1, i)));
      if (RAW_MESSAGE.test(body) && CLIENT_BODY.test(body)) {
        found.push({ file: path.relative(apiDir, f).split(path.sep).join("/"), line: src.slice(0, m.index).split("\n").length });
      }
    }
  }
  return found;
}

// ---- exemptions: correct as written, one reason each --------------------------
const EXEMPT = new Map<string, string>([
  [
    "health/route.ts",
    "the raw message is emitted only behind `trusted` — an operator-authenticated probe. " +
      "A health endpoint that hides why the DB is unavailable is the one place the detail is the answer.",
  ],
]);

// ---- the ceiling: routes that still leak, and by how much ----------------------
//
// ONE reason for the whole list, because one thing is true of all of them: they
// predate the shared responders and were never migrated. Do NOT add a route here to
// make a build green — migrating is `return safeJsonError(error, "api:<route>", "<CODE>")`
// plus a code in STORE_ERRORS and its four catalogue entries. Add an entry only for a
// route whose message is genuinely client-safe by construction, and then put it in
// EXEMPT above with its own reason instead.
//
// Measured 2026-09-01: 81 catch blocks across 68 files, plus the one exemption. One of
// the 81 (schedule/invite/bulk) was fixed in the same change rather than ceilinged, so
// the list below is 80 across 67 — the first tooth of the ratchet, taken on the way in.
const LEAK_CEILING = new Map<string, number>([
  ["analytics/route.ts", 1],
  ["archetypes/[id]/route.ts", 2],
  ["archetypes/route.ts", 2],
  // ats/config's single leak was FIXED, not ceilinged (/perfect 2026-09-03,
  // integrations-settings): the 500 answers safeJsonError(..., "ATS_CONFIG_SAVE_FAILED")
  // and the new stale-write 409 is jsonRefusal("ATS_CONFIG_STALE"), so the panel resolves
  // both in the reader's language. The row is deleted so the win is locked.
  ["automation/[task]/route.ts", 1],
  ["automation/run/route.ts", 1],
  // automation/schedule's single leak was FIXED, not ceilinged (/perfect 2026-09-03,
  // pipeline-board-3): the 500 answers safeJsonError(..., "SCHEDULE_UPDATE_FAILED")
  // and the interval 400 is jsonRefusal("SCHEDULE_INTERVAL_INVALID"), so the control
  // dock resolves both in the reader's language. The row is deleted so the win is locked.
  ["channels/inbound/[token]/route.ts", 1],
  // channels/webhooks' three leaks were FIXED, not ceilinged (/perfect wave 27,
  // api-comms): the two 500s answer safeJsonError(..., "CHANNEL_WEBHOOK_{CREATE,UPDATE}_FAILED")
  // and every 400/404 is a jsonRefusal code, so the Add-receiver modal and the receiver
  // list resolve them in the reader's language. The row is deleted so the win is locked.
  ["comms/relay/test/route.ts", 2],
  // decisions/config's single leak was FIXED, not ceilinged (/perfect 2026-09-02,
  // pipeline-composer): the 500 answers safeJsonError(..., "DECISION_CONFIG_SAVE_FAILED")
  // and both 400s are jsonRefusal codes, so the Hiring composer resolves them in the
  // reader's language. The row is deleted so the win is locked.
  // decisions/group-eval's single leak was FIXED, not ceilinged (/perfect 2026-09-03,
  // group-eval-ui): the 500 answers safeJsonError(..., "GROUP_EVAL_READ_FAILED"), so the
  // Decisions modal resolves it in the reader's language. The row is deleted so the win
  // is locked.
  ["decisions/screen-wave/route.ts", 1],
  // The ten devcase rows that stood here (thirteen leaks across comms, control,
  // inbound, lifecycle + its [id]/approve, [id]/close, [id]/redesign, outcomes,
  // postings and promote) were FIXED, not ceilinged (/perfect 2026-09-02,
  // api-devcase-1): every one now answers `safeJsonError(error, "api:devcase/<route>",
  // "DEVCASE_*_FAILED")` against the twelve codes added to STORE_ERRORS in the same
  // change, with four catalogue entries each. The entries are DELETED so the win is
  // locked and a regression reads as `undeclared` rather than as budget already
  // granted. Two devcase leaks remain in devcase/route.ts, still ceilinged below;
  // source and submit burnt theirs down in wave 9 and their entries are gone.
  // devcase/route.ts's last two leaks were FIXED, not ceilinged (/perfect wave 31,
  // api-devcase-2): the list read answers safeJsonError(..., "DEVCASE_CASE_LIST_FAILED")
  // and the manual approve safeJsonError(..., "DEVCASE_APPROVE_FAILED"), the same code
  // its lifecycle sibling uses for the same human decision. The row is deleted so the
  // win is locked and a regression reads as `undeclared` rather than as budget already
  // granted - devcase/** now carries no ceiling at all.
  ["extract-text/route.ts", 1],
  // The ten jobs/** rows that stood here were FIXED, not ceilinged (/perfect
  // 2026-09-02, api-jobs): every one now answers `safeJsonError(error,
  // "api:jobs/<route>", "JOB_*_FAILED")` against the JOB_* codes added to
  // STORE_ERRORS in the same change. The entries are deleted so the win is locked and
  // a regression reads as `undeclared` rather than as budget already granted.
  ["llm/activity/route.ts", 1],
  // llm/keys/route.ts stood here at 1 and is FIXED, not ceilinged (/perfect 2026-09-03,
  // model-keys-need-the-org-key): its catch forwarded saveProviderKey's own message —
  // the resolved endpoint host, the rejected URL, the crypto helper's detail — and its
  // four other 400s were bare English the panel had to substring-sniff. All of them now
  // answer jsonRefusal("MODEL_KEY_*") with the provider as data. The entry is deleted so
  // a regression reads as `undeclared` rather than as budget already granted.
  ["llm/keys/test/route.ts", 1],
  ["llm/test/route.ts", 1],
  // match/route.ts stood here at 1 and is FIXED, not ceilinged (/perfect 2026-09-03,
  // match-route-answers-like-its-siblings): its leak was the WORST of the family —
  // `parseStderrError`'s raw stderr, i.e. match_cli's traceback and the temp workdir
  // path, forwarded verbatim. It now answers through app/api/matrix/matrix-error-code.ts
  // like its two siblings: jsonRefusal for the 429 and the engine's 4xx, safeJsonError
  // with MATCH_RUN_FAILED for the rest. The row is deleted so the win is locked and a
  // regression reads as `undeclared` rather than as budget already granted.
  // match/reasoning/route.ts and matrix/route.ts stood here at 1 each and are FIXED,
  // not ceilinged (/perfect 2026-09-03, matrix-ui-2): both now answer through
  // app/api/matrix/matrix-error-code.ts — jsonRefusal for the 429 and the engine's
  // 4xx, safeJsonError with a MATRIX_*/MATCH_REASONING_* code for the rest. The rows
  // are deleted so the win is locked and a regression reads as `undeclared`.
  // ops/route.ts stood here at 1 and is FIXED, not ceilinged (/perfect wave 17,
  // api-workspace): its catch forwarded the thrown message for a payload built from
  // better-sqlite3, the seed report and three log tails — the db file path, absolute
  // seed paths and the log directory, all to the System strip. It now answers
  // safeJsonError(error, "api:ops", "OPS_STATUS_FAILED"). The entry is DELETED so the
  // win is locked and a regression reads as `undeclared` rather than as budget
  // already granted; app/api/ops/ops-route.test.ts pins the code itself.
  ["profile/candidates/route.ts", 1],
  ["profile/draft/route.ts", 1],
  ["profile/route.ts", 4],
  // schedule/invite/bulk/route.ts was here at 1 and is FIXED, not ceilinged — the
  // entry is deleted so the win is locked and a regression reads as `undeclared`.
  // It is worth naming because it is the reason this file is a scan rather than a
  // seventh hand-listed array: the leak was `results.push({ …, error: err.message })`
  // inside a per-entry loop, not a `NextResponse.json({ error: … })`, so BOTH
  // existing hygiene guards' regexes structurally could not see it.
  // tasks/route.ts (2) and tasks/[id]/retry/route.ts (1) were here and are FIXED,
  // not ceilinged — the entries are DELETED so the win is locked and a regression
  // reads as `undeclared`. Both doors now answer through the chokepoint:
  // safeJsonError on the two 500s, jsonRefusal + a TASK_* code on every refusal
  // (/perfect wave 17, background-tasks).
  ["tasks/history/route.ts", 1],
  ["tasks/seen/route.ts", 1],
]);

test("no NEW route shapes a thrown error's own message into a client response", (t) => {
  const files = walk(apiDir);
  const handlers = files.filter((f) => f.endsWith("route.ts"));
  // Non-vacuity floor: if the walk breaks, an empty scan passes and says nothing.
  assert.ok(handlers.length >= 150, `expected to scan the API surface, only found ${handlers.length} route handlers`);
  assert.ok(files.length > handlers.length, "the scan must also cover the colocated helper modules handlers delegate to");

  const counts = new Map<string, number>();
  const lines = new Map<string, number[]>();
  for (const o of offendersIn(files)) {
    if (EXEMPT.has(o.file)) continue;
    counts.set(o.file, (counts.get(o.file) ?? 0) + 1);
    lines.set(o.file, [...(lines.get(o.file) ?? []), o.line]);
  }

  const undeclared: string[] = [];
  const grew: string[] = [];
  const shrank: string[] = [];
  for (const [file, n] of counts) {
    const ceiling = LEAK_CEILING.get(file);
    if (ceiling === undefined) undeclared.push(`${file}  (${n} at line${n > 1 ? "s" : ""} ${lines.get(file)!.join(", ")})`);
    else if (n > ceiling) grew.push(`${file}  ${ceiling} -> ${n}  (lines ${lines.get(file)!.join(", ")})`);
  }
  for (const [file, ceiling] of LEAK_CEILING) {
    const n = counts.get(file) ?? 0;
    if (n < ceiling) shrank.push(`${file}  ${ceiling} -> ${n}`);
  }

  const HOW =
    "\n\nA thrown better-sqlite3 / fs / spawn error carries SQLITE_* codes, `UNIQUE constraint\n" +
    "failed: …`, the absolute db path and Python tracebacks in its .message. Answer through the\n" +
    "shared responder instead:\n\n" +
    '    return safeJsonError(error, "api:<route>", "<CODE>");\n\n' +
    "…adding <CODE> to STORE_ERRORS in app/_lib/api-response.ts and its four catalogue entries\n" +
    "(npm run i18n:check pins that). If the message is a deliberate, client-safe 4xx — a\n" +
    "validation rule, a business refusal — it belongs in REFUSAL_ERRORS behind jsonRefusal.\n" +
    "See docs/architecture/api-contracts.md §1.1. Adding a line to LEAK_CEILING to go green is\n" +
    "the one thing this file exists to prevent.";

  assert.deepEqual(undeclared.sort(), [], `These route files leak a raw thrown message and are not on the ceiling:\n  ${undeclared.join("\n  ")}${HOW}`);
  assert.deepEqual(grew.sort(), [], `These route files leak MORE than their declared ceiling:\n  ${grew.join("\n  ")}${HOW}`);

  // A count below its ceiling is a NOTE, never a failure: making every removed leak a
  // red build taxes the fix rather than the debt (the rule ts-ratchet.mjs calls
  // "slack"). Lower the number by hand when you see this.
  for (const s of shrank) t.diagnostic(`leak-ceiling slack — tighten it: ${s}`);
  for (const [file] of LEAK_CEILING) {
    if ((counts.get(file) ?? 0) === 0) t.diagnostic(`leak-ceiling burnt down, delete the entry to lock the win: ${file}`);
  }
});

test("every exemption carries a reason", () => {
  for (const [file, why] of EXEMPT) {
    assert.ok(why.trim().length > 20, `EXEMPT["${file}"] needs a real reason, not a placeholder`);
  }
});

// NON-VACUITY, proved rather than asserted — the same discipline
// route-tenancy-coverage.test.ts applies to itself. A scan whose whole output is
// "[] === []" looks identical whether it is clean or blind, and this scanner has three
// specific ways to go blind: reading comments as code, reading a door call as a
// response, and missing the shape that is not a NextResponse.json.
test("the scanner is not blind: it flags what it must and spares what it must", () => {
  const fixtures = new Map<string, string>([
    // Leaks: the classic shape.
    [
      path.join(apiDir, "fx", "classic", "route.ts"),
      `export async function GET(){ try { return null } catch (error) {\n` +
        `  return NextResponse.json({ error: error instanceof Error ? error.message : "x" }, { status: 500 }); } }\n`,
    ],
    // Leaks: via a local, which is how most of the real ones are written.
    [
      path.join(apiDir, "fx", "local", "route.ts"),
      `export async function GET(){ try { return null } catch (error) {\n` +
        `  const message = error instanceof Error ? error.message : "x";\n` +
        `  return NextResponse.json({ error: message }, { status: 500 }); } }\n`,
    ],
    // Leaks: into an array the handler later returns — the shape both hand-listed
    // hygiene guards miss, and the reason this scan keys on the body not the call.
    [
      path.join(apiDir, "fx", "push", "route.ts"),
      `export async function POST(){ const results: unknown[] = []; try { return null } catch (err) {\n` +
        `  results.push({ ok: false, error: err instanceof Error ? err.message : "mint failed" }); } }\n`,
    ],
    // Clean: the shared responder.
    [
      path.join(apiDir, "fx", "safe", "route.ts"),
      `export async function GET(){ try { return null } catch (error) {\n` +
        `  return safeJsonError(error, "api:fx", "JD_LOAD_FAILED"); } }\n`,
    ],
    // Clean: the raw message goes to a DOOR, not to the client — the false positive
    // that app/api/schedule/[token]/route.ts produced before DOOR_CALL existed.
    [
      path.join(apiDir, "fx", "door", "route.ts"),
      `export async function POST(){ try { return null } catch (e) {\n` +
        `  const reason = e instanceof Error ? e.message : String(e);\n` +
        `  await logScheduleReconcile({ token: "t", entry_id: "1", slot: "s", error: reason }); } }\n`,
    ],
    // Clean: prose describing the defect is not the defect. api-response.ts's own
    // comment quotes this exact expression.
    [
      path.join(apiDir, "fx", "prose", "route.ts"),
      `// The error-shaping ternary \`error instanceof Error ? error.message : "…"\`\n` +
        `// was hand-rolled in dozens of route files; centralizing it gives one { error } envelope.\n` +
        `export const x = 1;\n`,
    ],
  ]);

  const flagged = offendersIn([...fixtures.keys()], (f) => fixtures.get(f) ?? "")
    .map((o) => o.file)
    .sort();

  assert.deepEqual(
    flagged,
    ["fx/classic/route.ts", "fx/local/route.ts", "fx/push/route.ts"],
    "the scanner must flag the direct, the via-a-local and the pushed-into-an-array shapes, " +
      "while sparing the shared responder, a raw message routed to a door, and prose about the defect",
  );
});
