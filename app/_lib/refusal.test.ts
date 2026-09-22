// Challenge 2026-09-22 shared-api-utilities/A — one throwable Refusal + answerFailure.
//
// A failure is either a DECISION (a refusal whose code is the information) or an
// ACCIDENT (a store/spawn fault whose message must stay in the server log). The lib
// module where the failure is born knows which one it is, so it throws a `Refusal`
// carrying the code; the route only routes it through `answerFailure`. These cases
// pin the class, the responder, the five migrated lib classes, a tree guard that
// stops a new code-carrying error from extending bare `Error`, and the six route
// catches that collapse to one answer.
//
// unit-db is the FIRST project import (points KP_DB_PATH at a throwaway file), because
// the migrated classes live in store modules.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { REFUSAL_ERRORS, STORE_ERRORS } from "./api-response.ts";

after(cleanupUnitDb);

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(LIB_DIR, "..", "..");

/** Imported per case, so a missing module fails each case on its own. */
const loadRefusal = () => import("./refusal.ts");
const loadResponder = async () => {
  const mod = (await import("./api-response.ts")) as Record<string, unknown>;
  const answerFailure = mod.answerFailure;
  assert.equal(typeof answerFailure, "function", "api-response.ts exports answerFailure");
  return answerFailure as (err: unknown, route: string, storeCode: string) => Response;
};

/** Run `fn` with console.error / console.info captured. */
async function withConsole<T>(fn: () => Promise<T> | T): Promise<{ result: T; errors: unknown[][]; infos: unknown[][] }> {
  const errors: unknown[][] = [];
  const infos: unknown[][] = [];
  const { error, info } = console;
  console.error = (...args: unknown[]) => void errors.push(args);
  console.info = (...args: unknown[]) => void infos.push(args);
  try {
    return { result: await fn(), errors, infos };
  } finally {
    console.error = error;
    console.info = info;
  }
}

test("case 1: a Refusal is an Error carrying code and status; its default message is the code", async () => {
  const { Refusal } = await loadRefusal();
  const r = new Refusal("POSTING_CLOSED", 410);
  assert.ok(r instanceof Error);
  assert.ok(r instanceof Refusal);
  assert.equal(r.code, "POSTING_CLOSED");
  assert.equal(r.status, 410);
  // The code, not REFUSAL_ERRORS[code]: that map lives beside NextResponse, and
  // refusal.ts must not pull it. The log line is still never empty.
  assert.equal(r.message, "POSTING_CLOSED");
  const withDetail = new Refusal("ATS_FIELD_MAP_INVALID", 400, { detail: "unknown mapped field \"foo\"" });
  assert.equal(withDetail.message, "unknown mapped field \"foo\"");
  assert.equal(withDetail.detail, "unknown mapped field \"foo\"");
});

test("case 2: answerFailure answers a Refusal as the refusal it is, and logs no fault", async () => {
  const { Refusal } = await loadRefusal();
  const answerFailure = await loadResponder();
  const { result: res, errors } = await withConsole(() =>
    answerFailure(new Refusal("POSTING_CLOSED", 410), "api:x", "DEVCASE_SUBMIT_FAILED"),
  );
  assert.equal(res.status, 410);
  assert.deepEqual(await res.json(), { error: REFUSAL_ERRORS.POSTING_CLOSED, code: "POSTING_CLOSED" });
  assert.equal(errors.length, 0, "a refusal is an expected outcome, not a fault");
});

test("case 3: answerFailure hides an accident behind the store code and logs it once", async () => {
  const answerFailure = await loadResponder();
  const { result: res, errors } = await withConsole(() =>
    answerFailure(new Error("SQLITE_CORRUPT: /abs/data/kp.sqlite"), "api:x", "DEVCASE_SUBMIT_FAILED"),
  );
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { error: STORE_ERRORS.DEVCASE_SUBMIT_FAILED, code: "DEVCASE_SUBMIT_FAILED" });
  assert.ok(!text.includes("SQLITE"));
  assert.ok(!text.includes("kp.sqlite"));
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "[api:x] DEVCASE_SUBMIT_FAILED");
});

test("case 4: operator detail stays off the wire and goes to the info log", async () => {
  const { Refusal } = await loadRefusal();
  const answerFailure = await loadResponder();
  const { result: res, errors, infos } = await withConsole(() =>
    answerFailure(
      new Refusal("ATS_FIELD_MAP_INVALID", 400, { detail: 'unknown mapped field "foo"' }),
      "api:x",
      "ATS_CONNECTION_SAVE_FAILED",
    ),
  );
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.equal(JSON.parse(text).code, "ATS_FIELD_MAP_INVALID");
  assert.ok(!text.includes("unknown mapped field"));
  assert.equal(errors.length, 0);
  assert.ok(
    infos.some((args) => args.map(String).join(" ").includes('unknown mapped field "foo"')),
    "the detail is logged at info level",
  );
});

test("case 5: extra data rides beside the code, exactly as jsonRefusal(code, status, extra)", async () => {
  const { Refusal } = await loadRefusal();
  const answerFailure = await loadResponder();
  const { result: res } = await withConsole(() =>
    answerFailure(new Refusal("PAYLOAD_TOO_LARGE", 413, { extra: { maxBytes: 1024 } }), "api:x", "DEVCASE_SUBMIT_FAILED"),
  );
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: REFUSAL_ERRORS.PAYLOAD_TOO_LARGE, code: "PAYLOAD_TOO_LARGE", maxBytes: 1024 });
});

test("case 6: the migrated lib classes are Refusals with the code and status their routes answered", async () => {
  const { Refusal } = await loadRefusal();
  const { PostingClosedError } = await import("./distribution.ts");
  const { PortabilityError } = await import("./db-portability.ts");
  const { AtsConnectionError, AtsConnectionStaleError } = await import("./ats/connections-store.ts");
  const { AtsFieldMapError } = await import("./ats/field-map.ts");

  const closed = new PostingClosedError();
  assert.ok(closed instanceof Refusal);
  assert.equal(closed.code, "POSTING_CLOSED");
  assert.equal(closed.status, 410);
  assert.equal(closed.name, "PostingClosedError");

  const port = new PortabilityError("RESTORE_SCOPE_TAKEN", 409, "scope owned by another org");
  assert.ok(port instanceof Refusal);
  assert.ok(port instanceof PortabilityError);
  assert.equal(port.code, "RESTORE_SCOPE_TAKEN");
  assert.equal(port.status, 409);
  assert.equal(port.message, "scope owned by another org", "the operator English a script run prints stays");

  const conn = new AtsConnectionError("not an ATS: greenhoose", "ATS_CONNECTION_PROVIDER_UNKNOWN");
  assert.ok(conn instanceof Refusal);
  assert.equal(conn.code, "ATS_CONNECTION_PROVIDER_UNKNOWN");
  assert.equal(conn.status, 400);
  assert.equal(conn.message, "not an ATS: greenhoose");

  const stale = new AtsConnectionStaleError("version 3 is not 2");
  assert.ok(stale instanceof Refusal);
  assert.ok(stale instanceof AtsConnectionError, "the stale write still subclasses the connection error");
  assert.equal(stale.code, "ATS_CONNECTION_STALE");
  assert.equal(stale.status, 409);

  const map = new AtsFieldMapError('unknown mapped field "foo"');
  assert.ok(map instanceof Refusal);
  assert.equal(map.code, "ATS_FIELD_MAP_INVALID");
  assert.equal(map.status, 400);
  assert.equal(map.message, 'unknown mapped field "foo"');
});

// ---- case 7: the tree guard ---------------------------------------------------

const REFUSAL_KEYS = new Set(Object.keys(REFUSAL_ERRORS));

/** Brace-matched body of the class whose `{` sits at `open`. */
function bodyFrom(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/** Classes that carry a REFUSAL code while extending bare `Error`: a `code` typed
 *  RefusalErrorCode (or a same-file alias whose literals are all refusal keys), or a
 *  `code` initialised to a refusal key. Such a class is a Refusal that forked the shape. */
function forkedRefusalClasses(src: string): string[] {
  const refusalTypes = new Set(["RefusalErrorCode"]);
  const ALIAS = /type\s+(\w+)\s*=\s*((?:\s*\|?\s*"[A-Za-z0-9_]+")+)\s*;/g;
  for (const m of src.matchAll(ALIAS)) {
    const literals = [...m[2].matchAll(/"([A-Za-z0-9_]+)"/g)].map((l) => l[1]);
    if (literals.length > 0 && literals.every((l) => REFUSAL_KEYS.has(l))) refusalTypes.add(m[1]);
  }
  const found: string[] = [];
  for (const m of src.matchAll(/class\s+(\w+)\s+extends\s+Error\s*\{/g)) {
    const body = bodyFrom(src, (m.index ?? 0) + m[0].length - 1);
    const typed = [...body.matchAll(/\bcode\s*\??\s*:\s*(\w+)/g)].some((t) => refusalTypes.has(t[1]));
    const assigned = [...body.matchAll(/\bcode\s*(?::[^=;\n]+)?=\s*"([A-Za-z0-9_]+)"/g)].some((a) => REFUSAL_KEYS.has(a[1]));
    if (typed || assigned) found.push(m[1]);
  }
  return found;
}

function libSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      libSources(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

test("case 7: no lib error class forks the Refusal shape, and refusal.ts pulls nothing at runtime", () => {
  // The detector is proven on a fixture first, so a clean tree means clean, not blind.
  assert.deepEqual(
    forkedRefusalClasses('class A extends Error { readonly code: RefusalErrorCode; }\nclass B extends Refusal { readonly code: RefusalErrorCode; }'),
    ["A"],
  );
  assert.deepEqual(forkedRefusalClasses('class C extends Error { readonly code: RefusalErrorCode = "POSTING_CLOSED"; }'), ["C"]);
  assert.deepEqual(
    forkedRefusalClasses('type PC = "POSTING_CLOSED" | "PAYLOAD_TOO_LARGE";\nclass D extends Error { readonly code: PC; }'),
    ["D"],
  );
  assert.deepEqual(forkedRefusalClasses('type G = "unknown" | "api";\nclass E extends Error { readonly code: G; }'), []);

  const offenders: string[] = [];
  for (const file of libSources(LIB_DIR)) {
    if (path.basename(file) === "refusal.ts") continue; // the base itself
    for (const cls of forkedRefusalClasses(readFileSync(file, "utf8"))) {
      offenders.push(`${path.relative(REPO, file).split(path.sep).join("/")}: ${cls}`);
    }
  }
  // A ratchet, not an exemption list: each entry is a fork found by this guard that sat
  // outside the change that introduced Refusal, and it only ever shrinks. A stale entry
  // (the class was migrated) fails too, so the list cannot outlive its reason.
  const KNOWN_FORKS = new Set([
    // COMMS_SUPPRESSED/409 — app/api/comms/[id]/resend/route.ts still maps it by hand.
    "app/_lib/comms.ts: CommsSuppressedError",
  ]);
  for (const known of KNOWN_FORKS) {
    assert.ok(offenders.includes(known), `${known} is no longer a fork — delete it from KNOWN_FORKS`);
  }
  assert.deepEqual(
    offenders.filter((o) => !KNOWN_FORKS.has(o)),
    [],
    "a class carrying a refusal code extends Refusal (app/_lib/refusal.ts)",
  );

  const refusalSrc = readFileSync(path.join(LIB_DIR, "refusal.ts"), "utf8");
  assert.doesNotMatch(refusalSrc, /from\s+["']next\/server["']/, "refusal.ts must not pull NextResponse");
  const runtimeImports = [...refusalSrc.matchAll(/^\s*import\s+(?!type\b)[^;]*;/gm)].map((m) => m[0].trim());
  assert.deepEqual(runtimeImports, [], "refusal.ts imports types only — any lib module can throw it");
});

// ---- case 8: the six route catches ---------------------------------------------

const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

test("case 8: the migrated route catches collapse to one answerFailure", () => {
  const ROUTES: [string, string, string][] = [
    ["app/api/devcase/inbound/route.ts", "api:devcase/inbound", "DEVCASE_INTAKE_FAILED"],
    ["app/api/devcase/submit/route.ts", "api:devcase/submit", "DEVCASE_SUBMIT_FAILED"],
    ["app/api/devcase/session/[id]/submit/route.ts", "api:devcase/session/submit", "DEVCASE_SUBMIT_FAILED"],
    ["app/api/workspace/export/route.ts", "api:workspace/export", "WORKSPACE_EXPORT_FAILED"],
    ["app/api/workspace/import/route.ts", "api:workspace/import", "WORKSPACE_RESTORE_FAILED"],
  ];
  for (const [rel, route, code] of ROUTES) {
    const src = read(rel);
    assert.ok(src.includes(`return answerFailure(error, "${route}", "${code}");`), `${rel}: ends in one answerFailure`);
    assert.doesNotMatch(src, /instanceof\s+(PostingClosedError|PortabilityError)\b/, `${rel}: no bespoke refusal branch left`);
  }
  const ats = read("app/api/ats/connections/route.ts");
  assert.match(ats, /instanceof AtsConnectionStaleError/, "the stale branch stays: it attaches the live row");
  assert.doesNotMatch(ats, /instanceof\s+(AtsConnectionError|AtsFieldMapError)\b/);
  assert.ok(ats.includes('return answerFailure(error, "api:ats/connections", "ATS_CONNECTION_SAVE_FAILED");'));
});
