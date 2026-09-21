import assert from "node:assert/strict";
import { test } from "node:test";
import { _resetTaskRunnersForTests, externalRunner, registerTaskRunner } from "./task-external-runners";

// The registry is process-wide, not module-wide: Next evaluates this module once in
// the instrumentation chunk (which registers at boot) and once in the route chunk
// (which reads when a task runs). The first manual scan in a production build failed
// with "not registered" for exactly that reason, so the map must live on globalThis.
test("a registration is visible through globalThis, not only through this module instance", () => {
  _resetTaskRunnersForTests();
  const run = async () => "ran";
  registerTaskRunner("smoke_kind", run);
  const holder = globalThis as typeof globalThis & { __kpTaskRunners?: Map<string, unknown> };
  assert.equal(holder.__kpTaskRunners?.get("smoke_kind"), run);
  assert.equal(externalRunner("smoke_kind"), run);
  _resetTaskRunnersForTests();
});

test("an unregistered kind throws a message that names the boot registration", () => {
  _resetTaskRunnersForTests();
  assert.throws(() => externalRunner("nobody_registered_this"), /instrumentation-node\.ts/);
});
