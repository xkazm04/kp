// bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #3): spawnPython must close
// the child's stdin. Several CLIs fall back to `json.loads(sys.stdin.read() or "{}")`
// when their --input flag is absent; with the default stdio the child's stdin is an
// open pipe the bridge never feeds or closes, so that read would block until the 600s
// timeout. Ending stdin immediately makes an unfed read see EOF at once.
//
// Hermetic: we stand `node` in for PYTHON_CMD (no Python needed) and run a child that
// echoes ONLY after stdin reaches 'end' — the exact shape of a stdin-fallback CLI.
// NON-VACUITY: with the `child.stdin.end()` line removed, 'end' never fires, the child
// hangs, and the 4s timeout rejects the promise — this test fails. With the fix it
// resolves well inside the budget. (Confirmed by commenting the line out: timed out.)
import { test } from "node:test";
import assert from "node:assert/strict";

// Use this Node binary as the "interpreter" so the test needs no Python toolchain.
process.env.PYTHON_CMD = process.execPath;
const { spawnPython } = await import("./python-runner.ts");

test("spawnPython closes the child's stdin so a stdin-reading CLI does not hang", async () => {
  // Prints its JSON result only once stdin reaches EOF.
  const script =
    "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({stdin:d}));process.exit(0)});";
  const { result } = spawnPython(["-e", script], { timeoutMs: 4000 });
  const { stdout, exitCode } = await result;
  assert.equal(exitCode, 0);
  assert.equal(stdout.trim(), JSON.stringify({ stdin: "" }));
});
