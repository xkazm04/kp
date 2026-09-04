// Locks the server half of the one end-to-end max-input file-size contract
// (idea-36cc4b87): every upload Route Handler must reject an over-limit file
// with the shared FILE_TOO_LARGE_STATUS (413) — not a hand-rolled 400 — so "too
// big" is reported the same way wherever a file enters, and the limit + status
// live in exactly one place.
//
// Both routes now reach that contract through the one shared server gate,
// validateUploadServer (idea-5b61d729): the over-limit branch lives in
// upload-constraints.ts, and each route just delegates to it instead of
// re-checking MIME/size inline. So this source-level guard (the route modules
// import via the "@/..." alias, which Node's test runner does not resolve)
// asserts two things — the routes delegate to the shared gate, and the shared
// gate wires the size branch to FILE_TOO_LARGE_STATUS. The contract values are
// exercised behaviorally in app/_lib/upload-constraints.test.ts.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FILE_TOO_LARGE_STATUS, MAX_FILE_BYTES } from "../_lib/upload-constraints.ts";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

const apiDir = path.dirname(fileURLToPath(import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, out);
    } else if (e.name === "route.ts") {
      out.push(p);
    }
  }
  return out;
}

const ROUTES = ["./analyze/route.ts", "./extract-text/route.ts"];

for (const rel of ROUTES) {
  test(`${rel} rejects an over-limit upload via the shared server gate`, () => {
    const src = read(rel);

    // Both routes must gate uploads through the one shared validator from
    // upload-constraints.ts rather than re-checking MIME/size inline — that
    // shared gate is what keeps "too big" wired to FILE_TOO_LARGE_STATUS.
    assert.match(src, /from "@\/app\/_lib\/upload-constraints"/, "must read the upload-size contract");
    // A CALL, not the bare identifier. `/validateUploadServer/` alone was satisfied by
    // the IMPORT LINE in both routes, so deleting the call site while leaving the import
    // (an easy "unused variable" style edit, or a half-finished refactor) kept this guard
    // green while the route accepted an unbounded file. The `(` is what makes it a gate.
    assert.match(src, /validateUploadServer\(/, "must CALL the shared server gate — an import gates nothing");

    // No hand-rolled size branch in the route: the `file.size > MAX_FILE_BYTES`
    // guard now lives only in the shared gate, so a route can't quietly collapse
    // "too big" back into a bare `status: 400`.
    assert.doesNotMatch(
      src,
      /file\.size > MAX_FILE_BYTES/,
      "the over-limit check must live in the shared gate, not inline in the route",
    );
  });
}

// The shared gate is the one place the over-limit branch lives: a
// `file.size > MAX_FILE_BYTES` guard returning the shared 413 status with the
// shared message. If someone "simplifies" it to a bare 400, this fails rather
// than silently re-merging the two rejection reasons.
test("validateUploadServer wires the over-limit branch to FILE_TOO_LARGE_STATUS", () => {
  const src = read("../_lib/upload-constraints.ts");
  assert.match(src, /fileTooLargeMessage/, "must use the shared over-limit message");
  const sizeBranch = src.match(/file\.size > MAX_FILE_BYTES[\s\S]{0,160}?status:\s*([A-Za-z0-9_]+)/);
  assert.ok(sizeBranch, "expected a `file.size > MAX_FILE_BYTES` guard returning a status");
  assert.equal(sizeBranch[1], "FILE_TOO_LARGE_STATUS", "the over-limit branch must return FILE_TOO_LARGE_STATUS");
});

// Belt-and-suspenders: the shared constant is the RFC 9110 "Content Too Large"
// code. If someone "simplifies" it back to 400, this and the route guards fail
// together rather than silently re-merging the two rejection reasons.
test("FILE_TOO_LARGE_STATUS is 413", () => {
  assert.equal(FILE_TOO_LARGE_STATUS, 413);
});

// The audio gate is a SECOND ceiling and the SAME two statuses. The failure this
// pins is the tempting one: an audio route that answers "too big" with a bare
// 400 because 25 MB felt like a different kind of problem than 8 MB did.
test("the audio gate reaches the same FILE_TOO_LARGE_STATUS", () => {
  const src = read("../_lib/upload-constraints.ts");
  const branch = src.match(/file\.size > MAX_AUDIO_BYTES[\s\S]{0,160}?status:\s*([A-Za-z0-9_]+)/);
  assert.ok(branch, "expected a `file.size > MAX_AUDIO_BYTES` guard returning a status");
  assert.equal(branch[1], "FILE_TOO_LARGE_STATUS", "the audio over-limit branch must return FILE_TOO_LARGE_STATUS");
});

// The THIRD enforcement point, and the one nothing pinned until now: two more upload
// routes (`/api/sim/apply-cv`, `/api/channels/inbound/[token]`) never call
// validateUploadServer themselves — they hand the File to `extractUploadedText`, which
// is where their size gate lives. Deleting that one call would have removed the 413
// contract from half the upload surface with every guard in this file still green.
test("cv-intake's shared extractor gates the file before it spawns anything", () => {
  const src = read("../_lib/cv-intake.ts");
  const at = src.indexOf("validateUploadServer(");
  assert.ok(at >= 0, "extractUploadedText must call the shared server gate");
  // The rejection must be RETURNED with its status, not logged and walked past.
  assert.match(
    src.slice(at, at + 200),
    /rejection\.status/,
    "the rejection's shared status must be surfaced to the caller",
  );
  // …and it must run before the Python subprocess, or an over-limit file is paid for
  // (workdir write + spawn) before it is refused.
  const spawnAt = src.indexOf("spawnPython(");
  assert.ok(spawnAt > at, "the size gate must precede the extractor subprocess");
});

// COVERAGE, not a pin list. The three tests above name their routes by hand, so a NEW
// file-accepting route inherits nothing — which is exactly how `/api/sim/apply-cv` and
// `/api/channels/inbound/[token]` came to be uploads this contract never mentioned.
// Derive the file-accepting surface from the source instead and require every member of
// it to reach the one shared gate, directly or through the shared extractor pinned above.
test("every file-accepting route reaches the one shared upload gate", () => {
  const routes = walk(apiDir);
  assert.ok(routes.length >= 50, `expected to scan the API surface, only found ${routes.length} routes`);

  const uploaders = routes.filter((f) => {
    const s = readFileSync(f, "utf8");
    return s.includes(".formData()") && s.includes("instanceof File");
  });
  // Non-vacuity: a broken heuristic must fail loudly, not pass with nothing to check.
  assert.ok(
    uploaders.length >= 4,
    `expected to find the file-accepting routes, found ${uploaders.length} — the scan is broken, not the code`,
  );

  const unguarded = uploaders
    .filter((f) => {
      const s = readFileSync(f, "utf8");
      // Any of the three gates is fine; all are CALLS, and all end at 413 for
      // "too big" / 400 for "wrong kind". validateAudioUploadServer is the AUDIO
      // twin (/api/stt): a different ceiling and a different type list, because
      // 8 MB of PDF/DOCX/TXT/MD is the wrong contract for a recording — but the
      // same two statuses, which is the part that must never fork.
      return !/validateUploadServer\(/.test(s) && !/extractUploadedText\(/.test(s) && !/validateAudioUploadServer\(/.test(s);
    })
    .map((f) => path.relative(apiDir, f).replace(/\\/g, "/"))
    .sort();

  assert.deepEqual(
    unguarded,
    [],
    `These routes accept an uploaded File but never reach the shared upload gate, so the\n` +
      `8 MB / 413 contract does not apply to them:\n  ${unguarded.join("\n  ")}\n\n` +
      `Fix by calling validateUploadServer(file, label) and returning its rejection, or by\n` +
      `routing the file through extractUploadedText() like the CV-intake surfaces do.`,
  );
});

// THE THIRD SIZE LIMIT, which until now only a comment held. next.config.ts's
// `serverActions.bodySizeLimit` bounds Server Action request bodies, and
// upload-constraints.ts's note says it "is deliberately held above MAX_FILE_MB
// so any future Server-Action upload path still clears one max-size document
// plus multipart framing overhead. If you raise MAX_FILE_MB toward ~9, raise
// this too." That instruction is prose in two files pointing at each other, and
// nothing reads either one: raising MAX_FILE_MB to 12 today leaves the ceiling
// at 10mb, every gate green, and the first Server-Action upload path anyone
// adds silently 413s on files the per-file contract says are fine.
//
// Read from the config SOURCE rather than importing it: next.config.ts pulls in
// the Next plugin chain, which the node test runner has no business booting for
// one number.
test("next.config's serverActions.bodySizeLimit stays above the per-file ceiling", () => {
  const src = readFileSync(path.join(apiDir, "..", "..", "next.config.ts"), "utf8");
  const m = src.match(/bodySizeLimit:\s*"(\d+(?:\.\d+)?)(mb|kb|b)"/i);
  assert.ok(m, "next.config.ts must declare serverActions.bodySizeLimit as a size string");
  const unit = { b: 1, kb: 1024, mb: 1024 * 1024 }[m[2].toLowerCase() as "b" | "kb" | "mb"];
  const limitBytes = Number(m[1]) * unit;

  assert.ok(
    limitBytes >= MAX_FILE_BYTES,
    `serverActions.bodySizeLimit is ${m[1]}${m[2]} (${limitBytes} bytes) but MAX_FILE_BYTES is ` +
      `${MAX_FILE_BYTES}. A Server-Action upload path would reject a file the one per-file ` +
      `contract accepts. Raise the limit in next.config.ts, or lower MAX_FILE_MB.`,
  );
  // …and with headroom, which is the part the comment actually asks for: a
  // multipart body is the file PLUS framing, so an exactly-equal ceiling is a
  // 413 waiting for the first max-size upload. 1 MB is the margin the comment's
  // 10mb-over-8MB choice already encodes.
  assert.ok(
    limitBytes >= MAX_FILE_BYTES + 1024 * 1024,
    `serverActions.bodySizeLimit (${m[1]}${m[2]}) leaves less than 1 MB over MAX_FILE_BYTES ` +
      `(${MAX_FILE_BYTES}) for multipart framing. next.config.ts's own note asks for the headroom.`,
  );
});
