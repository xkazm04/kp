// The lab gate is the whole security value of interview-lab.ts, and until this
// file nothing tested it.
//
// WHAT IT GUARDS. A tokenless POST to /api/interview/connect creates a throwaway
// "test" session and mints REAL short-lived provider credentials — an OpenAI
// Realtime client secret or an ElevenLabs signed URL. /interview-lab is a publicly
// routable page that walks exactly that path with no token and no auth, so in
// production an unauthenticated caller could loop it and drain the provider
// account (denial-of-wallet). One boolean stands between that and the internet,
// and its production default is the half that matters: a regression that flipped
// `NODE_ENV !== "production"` to `NODE_ENV === "development"`, or dropped the
// negation, would open the door on every self-hosted install and break no test.
//
// The function reads process.env at CALL time (not at module load), which is what
// makes both branches reachable here — and is itself a property worth pinning: a
// value captured at import would freeze the build-time flag into a runtime gate.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as lab from "./interview-lab.ts";
import { isInterviewLabEnabled } from "./interview-lab.ts";

/** Run `fn` with the two env vars the gate reads set to `env`, and restore after —
 *  including the "was not set at all" state, which `= undefined` does not reproduce
 *  (it sets the STRING "undefined" on some Node versions' env proxy). */
function withEnv(env: { NODE_ENV?: string; INTERVIEW_LAB_ENABLED?: string }, fn: () => void): void {
  // Through a mutable alias: NODE_ENV is typed read-only on ProcessEnv (Next declares
  // it so a component cannot reassign it), but the value the gate reads IS this
  // object, and swapping it is the only way to reach both branches of the gate.
  const bag = process.env as Record<string, string | undefined>;
  const keys = ["NODE_ENV", "INTERVIEW_LAB_ENABLED"] as const;
  const prior = keys.map((k) => [k, bag[k]] as const);
  try {
    for (const k of keys) {
      const v = env[k];
      if (v === undefined) delete bag[k];
      else bag[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of prior) {
      if (v === undefined) delete bag[k];
      else bag[k] = v;
    }
  }
}

test("production is CLOSED by default — no flag, no tokenless credential minting", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.equal(
      isInterviewLabEnabled(),
      false,
      "a production deploy with no opt-in must refuse the tokenless lab path",
    );
  });
});

test("production opens ONLY on the exact opt-in string", () => {
  withEnv({ NODE_ENV: "production", INTERVIEW_LAB_ENABLED: "1" }, () => {
    assert.equal(isInterviewLabEnabled(), true, "INTERVIEW_LAB_ENABLED=1 is the documented opt-in");
  });
  // A truthy-looking value is NOT the opt-in. This is deliberate and pinned: an
  // operator who writes `INTERVIEW_LAB_ENABLED=true` (or leaves `=0`, or an empty
  // value from a half-filled .env) must get the CLOSED door, because the failure
  // mode of guessing generously here is a drained provider account.
  for (const value of ["true", "yes", "0", "", "on", " 1"]) {
    withEnv({ NODE_ENV: "production", INTERVIEW_LAB_ENABLED: value }, () => {
      assert.equal(isInterviewLabEnabled(), false, `INTERVIEW_LAB_ENABLED=${JSON.stringify(value)} must not open the lab`);
    });
  }
});

test("outside production the lab is open, flag or no flag — it is the dev harness", () => {
  for (const nodeEnv of ["development", "test", undefined]) {
    withEnv({ NODE_ENV: nodeEnv }, () => {
      assert.equal(isInterviewLabEnabled(), true, `NODE_ENV=${String(nodeEnv)} must leave the harness usable`);
    });
  }
});

test("the gate is read per CALL, not captured at import", () => {
  // The page and the route decide at request time; a module-load capture would bake
  // the BUILD-time flag into a runtime gate and drift the two apart.
  withEnv({ NODE_ENV: "production" }, () => assert.equal(isInterviewLabEnabled(), false));
  withEnv({ NODE_ENV: "production", INTERVIEW_LAB_ENABLED: "1" }, () => assert.equal(isInterviewLabEnabled(), true));
  withEnv({ NODE_ENV: "production" }, () => assert.equal(isInterviewLabEnabled(), false));
});

test("the module is the GATE and nothing else — no English refusal copy rides along", () => {
  // It used to also export INTERVIEW_LAB_DISABLED_ERROR, a hardcoded English
  // sentence whose doc-comment claimed the route and the lab page shared it. Neither
  // read it: /connect answers jsonRefusal("INTERVIEW_LAB_DISABLED", 403) and the page
  // renders interview.lab.disabledBody from the catalog. A stale second source of
  // truth for a user-facing sentence is exactly what ships English to a Czech reader.
  assert.deepEqual(Object.keys(lab).sort(), ["isInterviewLabEnabled"]);
});

test("/api/interview/connect actually consults the gate before minting", () => {
  // The gate is worthless if the one caller that mints credentials stops asking.
  const src = readFileSync(
    fileURLToPath(new URL("../api/interview/connect/route.ts", import.meta.url)),
    "utf8",
  ).replace(/\r\n/g, "\n");
  assert.match(src, /import \{ isInterviewLabEnabled \} from "@\/app\/_lib\/interview-lab"/);
  const at = src.indexOf("if (!token && !isInterviewLabEnabled())");
  assert.ok(at > 0, "the tokenless branch must be the one the gate closes");
  assert.ok(src.slice(at, at + 300).includes('jsonRefusal("INTERVIEW_LAB_DISABLED", 403)'), "…with the coded refusal");
});
