import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeTempDirs, removeTempDirsInHook } from "./tmp-cleanup.ts";

function withLeakLog<T>(run: (log: string) => T): T {
  const scratch = mkdtempSync(path.join(tmpdir(), "kp-tmpclean-"));
  const log = path.join(scratch, "leaks.log");
  const saved = process.env.KP_TMP_LEAK_LOG;
  process.env.KP_TMP_LEAK_LOG = log;
  try {
    return run(log);
  } finally {
    if (saved === undefined) delete process.env.KP_TMP_LEAK_LOG; else process.env.KP_TMP_LEAK_LOG = saved;
    rmSync(scratch, { recursive: true, force: true });
  }
}

const busy = (): never => {
  throw Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" });
};

test("an after() hook logs and records a leaked folder instead of throwing", () => {
  withLeakLog((log) => {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (m: unknown) => void warnings.push(String(m));
    try {
      const leaked = removeTempDirsInHook(["/x/kp-busy", "/x/kp-fine"], (d) => (d.endsWith("busy") ? busy() : undefined));
      assert.deepEqual(leaked, ["/x/kp-busy"]);
    } finally {
      console.warn = orig;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /leaked \/x\/kp-busy \(EBUSY\)/);
    const rec = JSON.parse(readFileSync(log, "utf8").trim());
    assert.equal(rec.dir, "/x/kp-busy");
    assert.equal(rec.code, "EBUSY");
  });
});

test("the hook form removes a clean folder and records nothing", () => {
  withLeakLog((log) => {
    const dir = mkdtempSync(path.join(tmpdir(), "kp-tmpclean-ok-"));
    assert.deepEqual(removeTempDirsInHook([dir]), []);
    assert.equal(existsSync(dir), false);
    assert.equal(existsSync(log), false);
  });
});

test("the plain form stays loud: it removes a clean folder and has no swallow path", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kp-tmpclean-loud-"));
  removeTempDirs(dir);
  assert.equal(existsSync(dir), false);
  // a path rmSync cannot even stat into (a NUL byte) must surface, not be logged away
  assert.throws(() => removeTempDirs("bad\0path"));
});
