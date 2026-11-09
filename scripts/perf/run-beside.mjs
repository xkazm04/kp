// Runs two CI gates at once, the second one only after the first has finished writing a file.
//
//   node scripts/perf/run-beside.mjs --after-write <file> "npm run typecheck" "npm run lint"
//
// Why it exists: tsc and eslint are each effectively single-threaded and took 91 s and 117 s one
// after the other on a 4-core runner, so overlapping them is free wall-clock. docs/development/
// performance-budget.md has the measurement.
//
// Why the barrier: `npm run typecheck` starts by regenerating app/_lib/*.generated.ts with a plain
// truncate-then-write, and eslint lints those files. Starting both together leaves a window where
// eslint can read an empty file and report a parse error nobody caused. So the second command
// starts when <file> (the LAST file codegen writes) gets a new mtime. If the first command exits
// before that, the second starts anyway, so a failing typecheck still gets its lint report.
//
// Contract: every command runs to completion, and the exit code is non-zero when any of them
// failed. A signal death is a failure.
import { spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";

const BARRIER_POLL_MS = 100;
// Far above the few seconds codegen takes. Only a barrier that can never trip gets here.
const BARRIER_LIMIT_MS = Number(process.env.KP_RUN_BESIDE_BARRIER_MS) || 120_000;

function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null; // not written yet: any later appearance is a new mtime
  }
}

function start(command) {
  const label = command.replace(/^npm run /, "");
  const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream }).on("line", (line) => console.log(`[${label}] ${line}`));
  }
  const started = Date.now();
  const done = new Promise((resolve) => {
    child.on("error", (err) => {
      console.error(`[${label}] could not start: ${err.message}`);
      resolve(1);
    });
    child.on("close", (code, signal) => {
      const status = code ?? (signal ? 1 : 0);
      console.log(`[${label}] finished with exit code ${status} after ${Math.round((Date.now() - started) / 1000)} s`);
      resolve(status);
    });
  });
  return { done };
}

/** Resolves when `file` changes after `before`, when `exited` settles, or at the limit. */
async function barrier(file, before, exited) {
  let firstExited = false;
  exited.then(() => {
    firstExited = true;
  });
  const deadline = Date.now() + BARRIER_LIMIT_MS;
  while (Date.now() < deadline) {
    if (firstExited) return "first-command-exited";
    const now = mtimeOf(file);
    if (now !== null && now !== before) return "written";
    await new Promise((resolve) => setTimeout(resolve, BARRIER_POLL_MS));
  }
  return "limit";
}

const args = process.argv.slice(2);
if (args[0] !== "--after-write" || args.length !== 4) {
  console.error('usage: run-beside.mjs --after-write <file> "<first command>" "<second command>"');
  process.exit(2);
}
const [, file, firstCommand, secondCommand] = args;

const before = mtimeOf(file);
const first = start(firstCommand);
const reason = await barrier(file, before, first.done);
if (reason === "limit") console.log(`run-beside: ${file} was not written within ${BARRIER_LIMIT_MS} ms; starting anyway`);
const second = start(secondCommand);
const codes = await Promise.all([first.done, second.done]);
process.exit(codes.find((code) => code !== 0) ?? 0);
