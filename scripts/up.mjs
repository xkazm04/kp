#!/usr/bin/env node
// up — the ONE command a non-technical owner runs: `npm run up`.
//
// WHY THIS EXISTS: the README's local start was four commands, a Node version it
// got wrong (it said 20+, package.json requires 24), a `pip install` step that
// fails differently on every machine, and it landed the owner on the SEEDED demo
// corpus with the first-run wizard already marked done. This launcher checks the
// prerequisites in plain words, installs what is missing, and starts the app on the
// owner's OWN workspace.
//
// What it does, in order:
//   1. Node must be major 24 (package.json `engines`). Anything else: one sentence
//      and https://nodejs.org. This file therefore uses node builtins ONLY and no
//      syntax newer than an old Node can parse, so the sentence is what an owner on
//      Node 18/20 actually sees instead of a syntax error.
//   2. Python 3.11+, found exactly the way `npm run schemas:gen` finds it
//      (KP_PYTHON, then PYTHON_CMD, then the platform's usual names — the probe is
//      imported from scripts/schemas-gen.mjs, not re-implemented).
//   3. `npm ci` when node_modules is missing, or when a dependency package.json pins
//      to an exact version is installed at another one — the "code updated,
//      packages not" state (`npm install` when there is no lockfile).
//   4. `<python> -m pip install -r requirements.txt` when a package requirements.txt
//      pins is not installed at all (checked through importlib.metadata, derived
//      from the file itself — no second list). A package installed at a DIFFERENT
//      version is reported, not reinstalled: on a developer's machine that is
//      usually a deliberate environment, and the app runs on it.
//   5. Starts `next dev` through scripts/dev-guard.mjs (the same path `npm run dev`
//      takes), waits until /api/health answers, opens the browser.
//
// THE OWNER'S WORKSPACE vs THE DEMO
//   default   KP_EMPTY=1 + KP_DB_PATH=data/kp-owner.sqlite. KP_EMPTY=1 skips the
//             fixture seeding (app/_lib/db/seed-gate.ts), so the onboarding state is
//             never stamped 'completed' (app/_lib/db/core.ts) and the first-run
//             wizard fires. The file PERSISTS between launches — unlike
//             `npm run dev:empty`, which wipes data/kp-empty.sqlite every time.
//             KP_EMPTY=1 also moves Next's distDir to .next-empty (next.config.ts),
//             so this server cannot run at the same time as `npm run dev:empty`
//             (they share .next-empty/dev/lock); Next says so if you try.
//             An explicit KP_DB_PATH in the shell is honoured.
//   --demo    no KP_EMPTY, KP_SEED_DEMO=1, the default data/kp.sqlite: the seeded demo
//             corpus. Since operator triage T1 (2026-10-22) a plain `npm run dev` on a
//             fresh file boots EMPTY and asks "start empty or demo?" on first start, so
//             --demo opts in explicitly instead of riding the old seeded default.
//
// ENTERING THE WORKSPACE: '/' shows the public landing until the kp_entered marker
// is set, and the only thing that sets it is a POST to /api/auth/login (the
// landing's "Sign in" button, session-nav.enterWorkspace). There is no GET door and
// this launcher does not invent one, so the first visit is one click on "Sign in";
// the cookie keeps every later launch on the workspace.
//
// Usage:  npm run up                 your own workspace
//         npm run up -- --demo       the seeded demo instead
//         npm run up -- --check      check the prerequisites, install nothing, start nothing
//         npm run up -- --no-open    do not open a browser
//         npm run up -- --public     candidate pages on the internet (Cloudflare quick tunnel),
//                                    studio behind a password; see docs/architecture/self-hosting.md
// Fixtures: scripts/__tests__/up.test.mjs (run by `npm run test:docs`).
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pythonCandidates, findInterpreter } from "./schemas-gen.mjs";
import {
  CLOUDFLARED_INSTALL,
  askNewPassword,
  cloudflaredAvailable,
  freePort,
  killTunnel,
  operatorPasswordFromEnv,
  publicPasswordPlan,
  startQuickTunnel,
} from "./tunnel.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_MAJOR = 24;
const OWNER_DB = path.join("data", "kp-owner.sqlite");
const START_TIMEOUT_MS = 5 * 60 * 1000;

/** Major version from a `process.version`-shaped string ("v24.14.0" -> 24). */
export function nodeMajor(version) {
  const m = /^v?(\d+)\./.exec(String(version || ""));
  return m ? Number(m[1]) : null;
}

/** The flags this launcher understands. Unknown flags are reported, not ignored. */
export function parseArgs(argv) {
  const opts = { demo: false, check: false, open: true, help: false, public: false, unknown: [] };
  for (const arg of argv) {
    if (arg === "--demo") opts.demo = true;
    else if (arg === "--check") opts.check = true;
    else if (arg === "--no-open") opts.open = false;
    else if (arg === "--public") opts.public = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else opts.unknown.push(arg);
  }
  return opts;
}

/** `name==version` pins from requirements.txt text. Comments and blank lines skip. */
export function parseRequirements(text) {
  const pins = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*==\s*([^\s;]+)/.exec(line);
    if (m) pins.push({ name: m[1], version: m[2] });
  }
  return pins;
}

/** Compare pins against what the interpreter reports (name -> version | null). */
export function compareInstalled(pins, installed) {
  const missing = [];
  const mismatched = [];
  for (const pin of pins) {
    const have = installed ? installed[pin.name] : undefined;
    if (have == null) missing.push(pin.name);
    else if (have !== pin.version) mismatched.push(`${pin.name} ${have} (wants ${pin.version})`);
  }
  return { missing, mismatched };
}

/** Direct dependencies pinned to an EXACT version in package.json whose installed
 *  copy is absent or a different version. `readVersion(name)` answers the installed
 *  version or null. This is what catches "the code was updated, node_modules was
 *  not" (a `git pull` or a fresh ZIP over an old folder): a range-specified
 *  dependency cannot be judged without npm's resolver, so only exact pins count. */
export function staleNodeDeps(pkg, readVersion) {
  const stale = [];
  const all = { ...(pkg && pkg.dependencies), ...(pkg && pkg.devDependencies) };
  for (const [name, spec] of Object.entries(all)) {
    if (!/^\d+\.\d+\.\d+(?:[-+][^\s]*)?$/.test(String(spec))) continue;
    const have = readVersion(name);
    if (have !== spec) stale.push(`${name} ${have || "missing"} (wants ${spec})`);
  }
  return stale;
}

function installedNodeVersion(name) {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8")).version || null;
  } catch {
    return null; // not installed
  }
}

/** The address from Next's banner: "- Local:        http://localhost:3000". Both the
 *  ready banner and the "already running" message print it this way. */
export function extractLocalUrl(line) {
  const m = /Local:\s+(https?:\/\/[^\s]+)/.exec(String(line || ""));
  return m ? m[1].replace(/\/+$/, "") : null;
}

/** What an /api/health answer means for the owner. Any answer below 500 means the app is
 *  serving, and so does 503 (a readiness verdict, e.g. a stalled clock). Any OTHER 5xx
 *  is the error page Next serves when the app failed to compile or to open its
 *  database: the server is listening but nothing works, and announcing "running" then
 *  sends the owner to a blank "Internal Server Error" page with no hint where to look. */
export function healthVerdict(status) {
  return Number(status) < 500 || Number(status) === 503 ? "serving" : "broken";
}

/** The closing line of `--check`: ready, or exactly what runs first. The package lines
 *  above it are facts; an owner needs the verdict ("can I start it?") spelled out. */
export function checkVerdict({ hasNodeModules, staleNode, pyMissing }) {
  const todo = [];
  if (!hasNodeModules || staleNode.length > 0) todo.push("install the app's packages");
  if (pyMissing > 0) todo.push("install the Python packages");
  return todo.length === 0
    ? "Ready. Run \"npm run up\" to start."
    : `Ready to start. The first \"npm run up\" will ${todo.join(" and ")} (a few minutes), then start the app. Nothing else is needed from you.`;
}

/** The environment the dev server gets, per mode. Pure: env in, env out. */
export function serverEnv(env, { demo, python, publicUrl }) {
  const out = { ...env, DEV_GUARD_MAX_NODE: env.DEV_GUARD_MAX_NODE || "150", DEV_GUARD_WATCH_PARENT: "1" };
  if (python && !env.KP_PYTHON && !env.PYTHON_CMD) out.KP_PYTHON = python;
  if (publicUrl) {
    // APP_BASE_URL is the server override public-base-url.ts reads first. The NEXT_PUBLIC_
    // mirror is inlined when the dev server compiles a bundle, and `next dev` compiles
    // after this process starts, so it is effective here (it is NOT for a prebuilt app).
    out.APP_BASE_URL = publicUrl;
    out.NEXT_PUBLIC_APP_BASE_URL = publicUrl;
  }
  if (!demo) {
    out.KP_EMPTY = "1";
    if (!env.KP_DB_PATH) out.KP_DB_PATH = OWNER_DB;
  } else {
    out.KP_SEED_DEMO = "1";
  }
  return out;
}

const say = (line) => console.log(`[up] ${line}`);
const fail = (lines) => {
  for (const line of lines) console.error(`[up] ${line}`);
  process.exit(1);
};

const HELP = [
  "npm run up                 start KandiDate on your own workspace",
  "npm run up -- --demo       start the demo workspace (example jobs and candidates)",
  "npm run up -- --check      only check that Node.js and Python are ready",
  "npm run up -- --no-open    do not open the browser",
  "npm run up -- --public     put the candidate pages on the internet (needs cloudflared and a studio password)",
];

/** Run npm with the npm that launched us when there is one (no .cmd shim issues). */
function runNpm(args) {
  const npmCli = process.env.npm_execpath;
  const r = npmCli && npmCli.endsWith(".js")
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd: ROOT, stdio: "inherit" })
    : spawnSync("npm", args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  return r.status === 0;
}

const METADATA_PROBE = [
  "import json, sys",
  "from importlib import metadata",
  "out = {}",
  "for name in sys.argv[1:]:",
  "    try:",
  "        out[name] = metadata.version(name)",
  "    except metadata.PackageNotFoundError:",
  "        out[name] = None",
  "print(json.dumps(out))",
].join("\n");

function installedVersions(python, pins) {
  const r = spawnSync(python, ["-c", METADATA_PROBE, ...pins.map((p) => p.name)], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(String(r.stdout).trim().split(/\r?\n/).pop());
  } catch {
    return null; // unreadable answer: treat every package as missing, pip sorts it out
  }
}

function openBrowser(url) {
  const opts = { stdio: "ignore", detached: true };
  const child =
    process.platform === "win32"
      ? spawn("cmd", ["/c", "start", "", url], opts)
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], opts);
  child.on("error", () => say(`Could not open a browser. Open ${url} yourself.`));
  child.unref();
}

async function waitForHealth(url) {
  const started = Date.now();
  let nextNote = started + 30_000;
  let broken = 0; // consecutive error answers (compiling can briefly answer 500 once)
  while (Date.now() - started < START_TIMEOUT_MS) {
    try {
      // Any HTTP answer means the server is serving: a 503 is a readiness verdict
      // (e.g. a stalled clock), not "not started yet".
      const res = await fetch(`${url}/api/health`);
      if (healthVerdict(res.status) === "serving") return true;
      broken += 1;
      if (broken >= 3) return "broken";
    } catch {
      /* not listening yet — keep polling */
    }
    if (Date.now() > nextNote) {
      say("Still starting (the first start compiles the app and takes a minute or two)...");
      nextNote += 30_000;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    for (const line of HELP) console.log(line);
    return;
  }
  if (opts.unknown.length) fail([`Unknown option: ${opts.unknown.join(" ")}`, ...HELP]);

  // --public refuses open mode before anything is installed or started.
  let publicPassword = null; // typed this run; handed to the app's environment only, never written to disk
  if (opts.public && !opts.check) {
    // Judged as the app will see it: the env file Next would read, not the last one listed.
    const configured = operatorPasswordFromEnv(process.env, (f) => {
      try {
        return readFileSync(path.join(ROOT, f), "utf8");
      } catch {
        return null; /* no such env file */
      }
    });
    const plan = publicPasswordPlan({ KP_OPERATOR_PASSWORD: configured }, { isTTY: Boolean(process.stdin.isTTY) });
    if (plan.action === "refuse") fail([plan.message]);
    if (!cloudflaredAvailable()) {
      fail(["--public needs cloudflared (a free Cloudflare program) and it was not found. Install it, then run this again:", ...CLOUDFLARED_INSTALL.map((l) => `  ${l}`)]);
    }
    if (plan.action === "prompt") {
      say(plan.message);
      publicPassword = await askNewPassword().catch(() => fail(["Cancelled."]));
    }
  }

  // 1. Node
  const major = nodeMajor(process.version);
  if (major !== NODE_MAJOR) {
    fail([
      `KandiDate needs Node.js ${NODE_MAJOR} and this computer has ${process.version}. Install Node.js ${NODE_MAJOR} (LTS) from https://nodejs.org and run this again.`,
    ]);
  }
  say(`Node.js ${process.version} - ok`);

  // 2. Python
  const python = findInterpreter(pythonCandidates());
  if (!python) {
    const winTip = process.platform === "win32" ? ' In the installer, tick "Add python.exe to PATH".' : "";
    fail([
      `KandiDate needs Python 3.11 or newer and none was found. Install it from https://www.python.org/downloads/ and run this again.${winTip}`,
    ]);
  }
  const pyVersion = String(spawnSync(python, ["--version"], { encoding: "utf8" }).stdout || "").trim();
  say(`${pyVersion || "Python"} (${python}) - ok`);

  // 3. Node packages
  const hasNodeModules = existsSync(path.join(ROOT, "node_modules", "next", "package.json"));
  const staleNode = hasNodeModules
    ? staleNodeDeps(JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")), installedNodeVersion)
    : [];
  const nodeNeedsInstall = !hasNodeModules || staleNode.length > 0;
  const npmArgs = existsSync(path.join(ROOT, "package-lock.json")) ? ["ci"] : ["install"];

  // 4. Python packages
  const pins = parseRequirements(readFileSync(path.join(ROOT, "requirements.txt"), "utf8"));
  let py = compareInstalled(pins, installedVersions(python, pins));
  const pyNeedsInstall = py.missing.length > 0;
  const driftNote = () =>
    py.mismatched.length > 0 &&
    say(`Note: these Python packages are at other versions than requirements.txt asks for: ${py.mismatched.join(", ")}. The app still runs on them; you do not need to act. (To match exactly: ${python} -m pip install -r requirements.txt)`);

  if (opts.check) {
    say(
      !hasNodeModules
        ? `App packages - not installed yet (npm ${npmArgs[0]} will run)`
        : staleNode.length > 0
          ? `App packages - out of date, npm ${npmArgs[0]} will run: ${staleNode.join(", ")}`
          : "App packages - installed",
    );
    say(pyNeedsInstall ? `Python packages - ${py.missing.length} not installed yet (pip will run): ${py.missing.join(", ")}` : "Python packages - installed");
    driftNote();
    say(`Workspace - ${opts.demo ? "demo (data/kp.sqlite)" : `your own (${process.env.KP_DB_PATH || OWNER_DB})`}`);
    say(checkVerdict({ hasNodeModules, staleNode, pyMissing: py.missing.length }));
    say("Check finished. Nothing was installed or started.");
    return;
  }

  if (nodeNeedsInstall) {
    say(
      hasNodeModules
        ? `The app's packages are out of date (${staleNode.length} differ from package.json); reinstalling them (npm ${npmArgs[0]})...`
        : `Installing the app's packages (npm ${npmArgs[0]}). This takes a few minutes the first time...`,
    );
    if (!runNpm(npmArgs)) fail([`Installing the app's packages failed. The messages above say why; fix that and run "npm run up" again.`]);
  }
  if (pyNeedsInstall) {
    say("Installing the Python packages (pip install -r requirements.txt)...");
    const r = spawnSync(python, ["-m", "pip", "install", "-r", "requirements.txt"], { cwd: ROOT, stdio: "inherit" });
    py = compareInstalled(pins, installedVersions(python, pins));
    if (r.status !== 0 && py.missing.length > 0) {
      fail([
        "Installing the Python packages failed. The messages above say why.",
        `You can run it yourself: ${python} -m pip install -r requirements.txt`,
        'If it says "externally-managed-environment", install Python from https://www.python.org/downloads/ instead of a system package manager.',
      ]);
    }
  }
  driftNote();

  // 5. Start
  say(opts.demo ? "Starting the demo workspace (example jobs and candidates)..." : `Starting your own workspace (saved in ${process.env.KP_DB_PATH || OWNER_DB})...`);
  let tunnel = null;
  let appPort = null;
  if (opts.public) {
    appPort = await freePort(Number(process.env.PORT) || 3000);
    say("Opening the public tunnel (Cloudflare quick tunnel)...");
    try {
      tunnel = await startQuickTunnel(appPort);
    } catch (err) {
      fail([`Could not open the tunnel: ${err && err.message ? err.message : err}`]);
    }
    say(`Candidate links will use ${tunnel.url} (this address changes every time you start).`);
  }
  const env = serverEnv(process.env, { demo: opts.demo, python, publicUrl: tunnel && tunnel.url });
  if (publicPassword) env.KP_OPERATOR_PASSWORD = publicPassword;
  env.PATH = `${path.join(ROOT, "node_modules", ".bin")}${path.delimiter}${env.PATH || env.Path || ""}`;
  const child = spawn(process.execPath, [path.join(ROOT, "scripts", "dev-guard.mjs"), "next", "dev", ...(appPort ? ["--port", String(appPort)] : [])], {
    cwd: ROOT,
    env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  let url = null;
  let alreadyRunning = false;
  let announced = false;
  const onLine = (line) => {
    if (/already running/i.test(line)) alreadyRunning = true;
    const found = extractLocalUrl(line);
    if (found && !url) {
      url = found;
      if (!alreadyRunning) void announce();
    }
  };
  const pump = (stream, sink) => {
    let buf = "";
    stream.on("data", (chunk) => {
      sink.write(chunk);
      buf += chunk.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) onLine(line);
    });
  };
  pump(child.stdout, process.stdout);
  pump(child.stderr, process.stderr);

  async function announce() {
    if (announced) return;
    announced = true;
    say(`Waiting for ${url} to answer...`);
    const health = await waitForHealth(url);
    if (health === "broken") {
      say("The app started but cannot serve pages: it is answering with an error. The messages above say why (look for the first line that says Error).");
      say('Fix that, press Ctrl+C and run "npm run up" again. Your saved data is not affected.');
      return;
    }
    if (!health) {
      say(`The app did not answer within ${START_TIMEOUT_MS / 60000} minutes. The messages above say why.`);
      return;
    }
    if (opts.open) openBrowser(url);
    say(`KandiDate is running at ${url}`);
    say('First visit: click "Sign in" at the top of the page to enter your workspace.');
    if (tunnel) {
      say(`PUBLIC: candidate pages (schedule, interview, apply, status) are reachable by anyone with a link at ${tunnel.url}.`);
      say("The studio itself needs the password. Candidate links in mail and copied invites use the public address.");
    }
    say("Press Ctrl+C to stop.");
  }

  if (tunnel) {
    process.on("exit", () => killTunnel(tunnel.child));
    tunnel.child.on("exit", () => {
      say("The tunnel stopped; candidate links no longer work.");
      killTunnel(child);
    });
  }

  // Ctrl+C reaches the whole process group; dev-guard reaps the server tree and
  // exits, and we leave with it rather than racing it.
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => {});
  child.on("exit", (code) => {
    if (alreadyRunning && url && tunnel) {
      killTunnel(tunnel.child);
      say(`KandiDate is already running at ${url}, without this public address. Stop it and run "npm run up -- --public" again.`);
      process.exit(1);
    }
    if (alreadyRunning && url) {
      say(`KandiDate is already running at ${url} - opening it.`);
      if (opts.open) openBrowser(url);
      process.exit(0);
    }
    process.exit(code ?? 0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => fail([`Something unexpected went wrong: ${err && err.message ? err.message : err}`]));
}
