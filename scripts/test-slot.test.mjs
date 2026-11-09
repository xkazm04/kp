// Fixtures for the shared machine-wide slot (ADR 0029) as `typecheck` and `build` take it:
// a live owner makes the wrapper wait, a dead owner's lock is reclaimed, and an unwritable
// slot dir warns and runs anyway. Every case uses KP_TEST_SLOT_DIR, never the real slot.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./test-slot.mjs", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "kp-slot-fixture-"));
const baseEnv = { ...process.env, KP_TEST_SLOT_POLL_MS: "50" };
delete baseEnv.KP_TEST_SLOT;
delete baseEnv.KP_TEST_SLOT_HELD;

const CMD = ["node", "-e", JSON.stringify("console.log('ran')")];
const runWrapper = (slotDir) => ({
  args: [SCRIPT, "typecheck", ...CMD],
  env: { ...baseEnv, KP_TEST_SLOT_DIR: slotDir },
});

function writeOwner(dir, pid) {
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify({ pid, cwd: root, at: Date.now() }));
}

try {
  // 1. a live owner holds the slot: the wrapper announces the wait and does not run the command.
  {
    const slot = path.join(root, "live");
    const holder = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], { stdio: "ignore" });
    try {
      writeOwner(slot, holder.pid);
      const { args, env } = runWrapper(slot);
      const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      await new Promise((r) => setTimeout(r, 1200));
      assert.match(out, /typecheck — another suite is running on this machine \(pid \d+/);
      assert.ok(!out.includes("ran"), "the command must not start while a live owner holds the slot");
      // release the owner: the waiter takes the slot over (dead pid) and runs.
      holder.kill();
      const code = await new Promise((resolve) => child.on("close", resolve));
      assert.equal(code, 0);
      assert.ok(out.includes("ran"), "after the owner is gone the command runs");
      assert.ok(!fs.existsSync(slot), "the slot is released when the wrapper ends");
    } finally {
      holder.kill();
    }
  }

  // 2. a dead owner's lock is reclaimed at once.
  {
    const slot = path.join(root, "dead");
    const dead = spawnSync(process.execPath, ["-e", "0"]);
    writeOwner(slot, dead.pid); // exited and reaped: its pid is gone
    const { args, env } = runWrapper(slot);
    const res = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 20000 });
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes("ran"));
    assert.ok(!res.stdout.includes("waiting for it"), "a dead owner is not waited for");
    assert.ok(!fs.existsSync(slot));
  }

  // 3. the command's exit code passes through.
  {
    const res = spawnSync(process.execPath, [SCRIPT, "build", "node", "-e", JSON.stringify("process.exit(3)")], {
      env: { ...baseEnv, KP_TEST_SLOT_DIR: path.join(root, "code") },
      encoding: "utf8",
    });
    assert.equal(res.status, 3);
  }

  // 4. a slot that cannot be taken warns and runs anyway.
  {
    const blocker = path.join(root, "blocker");
    fs.writeFileSync(blocker, "a file, so mkdir under it fails with ENOTDIR");
    const res = spawnSync(process.execPath, [SCRIPT, "build", ...CMD], {
      env: { ...baseEnv, KP_TEST_SLOT_DIR: path.join(blocker, "slot") },
      encoding: "utf8",
    });
    assert.equal(res.status, 0);
    assert.match(res.stderr, /could not take the suite slot/);
    assert.ok(res.stdout.includes("ran"));
  }

  // 5. KP_TEST_SLOT_HELD (a child of a holding run) never waits.
  {
    const slot = path.join(root, "held");
    writeOwner(slot, process.pid);
    const res = spawnSync(process.execPath, runWrapper(slot).args, {
      env: { ...baseEnv, KP_TEST_SLOT_DIR: slot, KP_TEST_SLOT_HELD: String(process.pid) },
      encoding: "utf8",
      timeout: 20000,
    });
    assert.equal(res.status, 0);
    assert.ok(fs.existsSync(slot), "a child does not release a slot it does not own");
  }
  console.log("test-slot: 5 fixtures ok");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
