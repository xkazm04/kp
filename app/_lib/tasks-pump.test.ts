// The background runner's two invariants that nothing else pins:
//
//   1. FAIRNESS — the pump's pick is round-robin across tenants, so one workspace
//      cannot hold every slot while another waits. Tested over the PURE scheduler
//      (task-pump.ts) with a fake queue: no DB, no timers, no LLM.
//   2. TENANCY DECLARATION — every entry in the HANDLERS table of tasks.ts either
//      reaches `ctx.workspaceId` or says, on the row, that it is tenant-free. Six
//      kinds silently ignored the workspace the task row had carried since P2;
//      this is the guard that stops the seventh, and it is a SOURCE guard because
//      running the handlers means spawning Python and calling models.
//
// unit-db.ts is deliberately NOT imported: neither half touches the database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nextTaskToRun, type PumpEntry } from "./task-pump.ts";
import { TASK_KINDS } from "./task-kinds.ts";

// ---- 1. fairness ----------------------------------------------------------

const q = (...pairs: [string, string][]): PumpEntry[] =>
  pairs.map(([id, workspaceId]) => ({ id, workspaceId }));

test("a single tenant's queue stays plain FIFO", () => {
  const queue = q(["a1", "A"], ["a2", "A"], ["a3", "A"]);
  assert.equal(nextTaskToRun(queue, [], 2), 0);
  assert.equal(nextTaskToRun(queue, ["A"], 2), 0, "the next A task still leads when nobody else waits");
});

test("tenant B starts before tenant A's second task", () => {
  // THE regression. Team A submits two long runs, then team B clicks once. Under
  // the old process-global FIFO pump A took both slots and B waited out both LLM
  // runs; the workspace on the row was never read.
  const queue = q(["a1", "A"], ["a2", "A"], ["b1", "B"]);
  const first = nextTaskToRun(queue, [], 2);
  assert.equal(first, 0, "A submitted first, so A runs first");
  const [started] = queue.splice(first!, 1);
  assert.equal(started.id, "a1");

  const second = nextTaskToRun(queue, ["A"], 2);
  assert.equal(queue[second!].id, "b1", "with A already running, B's single task must beat A's second");
});

test("nothing starts once every slot is taken", () => {
  assert.equal(nextTaskToRun(q(["b1", "B"]), ["A", "A"], 2), null);
  assert.equal(nextTaskToRun([], [], 2), null);
});

test("the least-loaded tenant wins, and equal load falls back to queue order", () => {
  // Three tenants, a wider ceiling: C is idle, so C runs even though it queued last.
  const queue = q(["a2", "A"], ["b2", "B"], ["c1", "C"]);
  assert.equal(nextTaskToRun(queue, ["A", "B"], 4), 2, "the idle tenant is picked");
  // A holds two slots, B one → B's task is the fairer pick even though A queued first.
  assert.equal(nextTaskToRun(q(["a3", "A"], ["b2", "B"]), ["A", "A", "B"], 4), 1);
  // Same load everywhere ⇒ submission order decides.
  assert.equal(nextTaskToRun(q(["a3", "A"], ["b2", "B"]), ["A", "B"], 4), 0);
});

test("FIFO survives inside a workspace when that workspace is the fair pick", () => {
  const queue = q(["b1", "B"], ["b2", "B"], ["a2", "A"]);
  assert.equal(nextTaskToRun(queue, ["A"], 2), 0, "B's OLDEST queued task, not just any B task");
});

// ---- 2. every handler declares what it does with the tenant ----------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Normalized to LF before parsing: this checkout is CRLF on Windows and the
// ^...$ anchors below would otherwise see zero handler blocks (the wave-37c
// merge went red on main for exactly that).
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const tasksSrc = lf(readFileSync(path.join(HERE, "tasks.ts"), "utf8"));

/** The HANDLERS object literal's source text. Located by NAME, not by its exact
 *  type annotation, so retyping the table (it is `Record<TaskKind, Spec>` now) does
 *  not blind this guard. */
function handlersBody(): string {
  const head = tasksSrc.match(/^const HANDLERS\b[^=\n]*= \{$/m);
  assert.ok(head && head.index !== undefined, "the HANDLERS table must still be a named object literal");
  const end = tasksSrc.indexOf("\nlet booted = false;", head.index);
  assert.ok(end > head.index, "expected the runner state to follow HANDLERS");
  return tasksSrc.slice(head.index, end);
}

/** One text block per kind, found by walking TASK_KINDS (the vocabulary the table is
 *  typed by) rather than by counting whatever the regex happens to match. A kind whose
 *  block cannot be found fails here — never silently skipped. */
function handlerBlocks(): Map<string, string> {
  const body = handlersBody();
  const blocks = new Map<string, string>();
  for (const kind of TASK_KINDS) {
    // The closing brace is matched at the SAME indentation as the key (the `\1`
    // backreference), so a nested `run: async (ctx) => { … },` cannot end the block
    // early — whatever width the table happens to be indented by.
    const m = body.match(new RegExp(`^( *)${kind}: \\{\\n([\\s\\S]*?)^\\1\\},$`, "m"));
    assert.ok(m, `${kind}: no spec block in HANDLERS`);
    blocks.set(kind, m[2]);
  }
  return blocks;
}

/** Source of the module a whole-ctx delegate (`run: someFn`) lives in — tasks.ts
 *  itself for a local helper, else the file its import names. Returns null when the
 *  symbol cannot be resolved, which the caller treats as a failure rather than a pass. */
function delegateSource(symbol: string): string | null {
  if (new RegExp(`function ${symbol}\\(ctx: TaskCtx\\)`).test(tasksSrc)) return tasksSrc;
  const imp = tasksSrc.match(new RegExp(`import \\{[^}]*\\b${symbol}\\b[^}]*\\} from "\\.(/[\\w./-]+)"`));
  if (!imp) return null;
  for (const ext of [".ts", ".tsx", "/index.ts"]) {
    try {
      return lf(readFileSync(path.join(HERE, `.${imp[1]}${ext}`), "utf8"));
    } catch {
      // Try the next extension — a miss here is not an error until every form has failed.
    }
  }
  return null;
}

test("every task kind declares how it uses the enqueuing workspace", () => {
  const blocks = handlerBlocks();
  assert.equal(blocks.size, TASK_KINDS.length, "one spec block per kind in the vocabulary");
  for (const [kind, block] of blocks) {
    const declared = block.match(/^\s*tenancy: "(scoped|tenant-free)",/m);
    assert.ok(declared, `${kind}: no \`tenancy\` declaration — say whether it needs ctx.workspaceId`);
  }
});

test("a `scoped` handler actually reaches ctx.workspaceId", () => {
  for (const [kind, block] of handlerBlocks()) {
    if (!/tenancy: "scoped"/.test(block)) continue;
    if (block.includes("ctx.workspaceId")) continue;
    // The other legal shape: the whole ctx is handed to one function, which must
    // read the workspace itself. Resolve it and check — never assume.
    const delegate = block.match(/^\s*run: (?:(\w+),|\(ctx\) => (\w+)\(ctx\),)$/m);
    assert.ok(delegate, `${kind}: declared scoped but never mentions ctx.workspaceId`);
    const src = delegateSource(delegate[1] ?? delegate[2]);
    assert.ok(src, `${kind}: could not resolve the handler ${delegate[1] ?? delegate[2]}`);
    assert.match(src, /ctx\.workspaceId/, `${kind}: its handler ignores the task's workspace`);
  }
});

test("a `tenant-free` handler carries the reason on the row above it", () => {
  // A declaration nobody has to justify is a rubber stamp. Each opt-out must sit
  // under a comment, so the next reader learns WHY that kind touches no tenant store
  // rather than finding a bare enum value.
  const body = handlersBody();
  for (const m of body.matchAll(/tenancy: "tenant-free", \/\/ ?(.*)$/gm)) {
    assert.ok(m[1].trim().length > 20, `a tenant-free opt-out needs a real reason, got: ${m[1]}`);
  }
  const optOuts = [...body.matchAll(/tenancy: "tenant-free"/g)].length;
  const reasoned = [...body.matchAll(/tenancy: "tenant-free", \/\//g)].length;
  assert.equal(reasoned, optOuts, "every tenant-free declaration needs its reason on the same line");
});

test("the lifecycle resume threads the submission's workspace", () => {
  // The filed follow-up: three public devcase doors enqueued the resume under the
  // DEFAULT tenant, so a non-default team's collecting lifecycle either never
  // resumed or resumed against the wrong team's task tray.
  assert.match(
    tasksSrc,
    /export function resumeCollectingLifecycle\(postingId: string, workspaceId: string\)/,
    "the workspace must be required, not defaulted — a default is how this broke"
  );
  assert.match(tasksSrc, /startTask\("lifecycle", \{[^}]*\}, workspaceId\)/);
});
