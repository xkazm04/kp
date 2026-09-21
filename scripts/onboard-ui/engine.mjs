/**
 * kp installer wizard — the ENGINE.
 *
 * Everything that drives a headless Claude Code CLI session and nothing that
 * speaks HTTP. `server.mjs` is the HTTP shell over this module: routes, the SSE
 * fan-out, the per-run token, CORS, the static page. Split in v0.6 so a second
 * face — the in-app studio at `<app>/setup/studio` — can be a client of the same
 * engine, and so hosting the engine somewhere else later stays a refactor
 * rather than a rewrite (docs/concepts/onboarding-in-app.md).
 *
 * What lives here: CLI spawn + the argv self-check, the stream-json control
 * protocol, the permission policy and its hook settings file, host markers,
 * the host inventory, the wizard preamble, the .env.local merge, secret
 * handling, and the proxy into the booted app.
 *
 * The engine emits through an INJECTED sink — `new Session(sink)` where `sink`
 * takes one event object. The HTTP shell passes its SSE broadcaster; a driver
 * passes an array push. The engine itself knows nothing about connections, so
 * "how many faces are watching" is not its problem: the session state (pending
 * cards, phase, plan, the replay buffer) is single and server-side, which is
 * what makes two faces on one run agree.
 *
 * The engine is the process that approves shell commands and writes
 * .env.local. Its security posture — subscription login only, every
 * ANTHROPIC_*_KEY stripped, every tool call either policy-allowed by a written
 * rule or shown to the operator — is enforced here (a PreToolUse ask-hook plus
 * a launch self-check), measured (PROTOCOL.md records the runs), and kept
 * honest by a `notice` event for every decision made without a card.
 *
 * Zero npm dependencies by design — this is the FIRST thing a fresh clone runs,
 * possibly before `npm install`.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
// KP_ONBOARD_ENV_FILE exists so the merge path can be exercised against a
// throwaway file; the wizard itself always writes the repo's own .env.local.
export const ENV_FILE = process.env.KP_ONBOARD_ENV_FILE
  ? path.resolve(process.env.KP_ONBOARD_ENV_FILE)
  : path.join(REPO_ROOT, ".env.local");
const ENV_BASENAME = path.basename(ENV_FILE);

/** Test-only: pretend boot verify already reported this port for the app proxy. */
const APP_PORT_OVERRIDE = Number(process.env.KP_ONBOARD_APP_PORT) || null;
/* ------------------------------------------------------------------ *
 * Enforcement — "every command is either policy-allowed by the host or
 * asked" has to be a property this process ENFORCES, not one it hopes for.
 *
 * Two facts, both measured against claude 2.1.263 (see PROTOCOL.md
 * "Closing the invisible-command hole"):
 *
 *  1. `--permission-prompt-tool stdio` alone is NOT enough. The CLI's own
 *     classifier settles plainly-safe commands before the wire — `echo
 *     spike-ok` and `node --version` both EXECUTED with no `can_use_tool`.
 *  2. `--permission-mode manual` does not change that. It was the obvious
 *     candidate and it was measured: same two commands, still invisible.
 *
 * What does close it is a **PreToolUse hook that returns
 * `permissionDecision:"ask"`**. It runs ahead of the classifier AND ahead of
 * the permission rules, so every tool call is forced into the permission
 * flow, which `--permission-prompt-tool stdio` then routes here. Measured:
 * zero invisible calls, and an explicit `permissions.allow` rule for a
 * command no longer skips the wire either.
 *
 * `manual` is kept anyway — it is the mode whose NAME means what the page
 * claims, it costs nothing, and it is a second layer if the hook is ever
 * dropped by a future CLI. But the hook is what does the work, and
 * PROTOCOL.md says so rather than crediting the flag.
 * ------------------------------------------------------------------ */

export const PERMISSION_MODE = "manual";

/**
 * The hook body. Constant output, so it needs no stdin and cannot fail open
 * on a parse error; `node -e` because the hook runs through a shell and
 * quoting a JSON literal for both cmd.exe and sh is not worth the risk.
 */
const ASK_HOOK_COMMAND =
  "node -e \"process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse'," +
  "permissionDecision:'ask',permissionDecisionReason:'The kp installer host reviews every tool call.'}}))\"";

/**
 * Matcher `*`, not `Bash|PowerShell`. Shell commands are the headline, but
 * the env-file read guard below is only real if `Read`/`Grep` requests
 * actually REACH it — and in default mode a Read inside the cwd is settled
 * by the classifier too. Covering every tool is what makes that guard
 * enforceable rather than decorative. It costs one tiny process per tool
 * call and no operator-visible cards: read-only tools are auto-allowed here.
 */
const ENFORCEMENT_SETTINGS = {
  hooks: {
    PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: ASK_HOOK_COMMAND }] }],
  },
};

/** Anything that would let a tool call skip the host. Never in the argv. */
const FORBIDDEN_ARG_TOKENS = [
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "bypassPermissions",
  "dontAsk",
  "acceptEdits",
];

/**
 * `--settings` takes a file OR a JSON string, and the JSON string is a trap
 * here: with no `KP_CLAUDE_CLI` the cliPath is a bare `claude`, which means
 * `shell: true` on win32, which means cmd.exe re-parses the argv and eats
 * every `"` in the blob. Measured — the child received
 * `{hooks:{PreToolUse:[{matcher:*,…` and would have started with NO hook, i.e.
 * silently unenforced. A file path has nothing for a shell to chew on.
 */
function enforcementSettingsPath() {
  const file = path.join(tmpdir(), `kp-onboard-enforce-${randomBytes(6).toString("hex")}.json`);
  writeFileSync(file, JSON.stringify(ENFORCEMENT_SETTINGS, null, 2), "utf8");
  return file;
}

export function buildArgs(settingsPath = enforcementSettingsPath()) {
  return [
    "--output-format", "stream-json",
    "--verbose",
    "--input-format", "stream-json",
    "--permission-prompt-tool", "stdio",
    // Who answers a prompt: "host" is the default, but the invariant is worth
    // asserting rather than inheriting.
    "--permission-prompts", "host",
    "--permission-mode", PERMISSION_MODE,
    "--settings", settingsPath,
  ];
}

/**
 * cmd.exe strips quoting from the argv Node hands it under `shell: true`, so
 * anything with a space has to arrive already quoted. Only the settings path
 * can realistically contain one (a username with a space), but a flag that
 * splits in half is exactly the kind of failure that fails OPEN.
 */
function quoteForShell(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/**
 * Every way the launch could quietly stop asking. Returns the problems it
 * found; an empty array is the only acceptable answer at startup.
 */
export function assertEnforcement(args) {
  const problems = [];
  const list = Array.isArray(args) ? args.map((a) => String(a)) : [];

  const prompt = list.indexOf("--permission-prompt-tool");
  if (prompt < 0 || list[prompt + 1] !== "stdio") {
    problems.push("--permission-prompt-tool stdio is missing: nothing would reach the host.");
  }
  const mode = list.indexOf("--permission-mode");
  if (mode < 0 || list[mode + 1] !== PERMISSION_MODE) {
    problems.push(`--permission-mode ${PERMISSION_MODE} is missing.`);
  }
  for (const arg of list) {
    for (const bad of FORBIDDEN_ARG_TOKENS) {
      if (arg.includes(bad)) problems.push(`argv carries a permission bypass: ${bad}`);
    }
  }

  const settingsAt = list.indexOf("--settings");
  let hookOk = false;
  if (settingsAt >= 0) {
    // `--settings` is a path or an inline blob; read whichever this is, and
    // check the hook the CLI will actually load rather than the one intended.
    const raw = list[settingsAt + 1] ?? "";
    let text = raw;
    if (!raw.trim().startsWith("{")) {
      try { text = existsSync(raw) ? readFileSync(raw, "utf8") : ""; } catch { text = ""; }
    }
    try {
      const parsed = JSON.parse(text);
      for (const entry of parsed?.hooks?.PreToolUse ?? []) {
        for (const hook of entry?.hooks ?? []) {
          if (String(hook?.command ?? "").includes("permissionDecision:'ask'")) hookOk = true;
        }
      }
    } catch { /* settings that will not parse are themselves the failure */ }
  }
  if (!hookOk) {
    problems.push("the PreToolUse ask-hook is missing: the CLI would settle safe commands itself.");
  }
  return problems;
}

/**
 * Env vars that could change permission behavior, pick a different shell, or
 * inject settings. Stripped by prefix and then by an explicit keep-list,
 * because the CLAUDE_CODE_* surface is ~500 names wide and a deny-list would
 * be stale the day it was written.
 *
 * Honest scope: this does NOT pretend to sandbox the child. It inherits the
 * operator's PATH, so which `node` or `git` runs is still the machine's
 * business. What it removes is the class of variable that turns asking OFF.
 */
const ENV_KEEP_EXACT = new Set([
  "CLAUDE_CODE_ENTRYPOINT",       // we set it ourselves, immediately below
  "CLAUDE_CODE_GIT_BASH_PATH",    // how the Bash tool finds a shell on Windows
  "CLAUDE_CODE_TMPDIR",
  "CLAUDE_CODE_API_KEY_HELPER_TTL_MS",
  "CLAUDE_CODE_CERT_STORE",
  "CLAUDE_CODE_CLIENT_CERT",
  "CLAUDE_CODE_CLIENT_KEY",
  "CLAUDE_CODE_CLIENT_KEY_PASSPHRASE",
  "CLAUDE_CODE_HTTP_PROXY",
  "CLAUDE_CODE_HTTPS_PROXY",
  "CLAUDE_CODE_PROXY_URL",
]);

/** Non-CLAUDE_CODE_* names that are known permission or shell levers. */
const ENV_STRIP_EXACT = [
  "IS_SANDBOX",
  "BASH_ENV",
  "CLAUDE_BG_SESSION_PERMISSION_RULES",
  "CLAUDE_CHROME_PERMISSION_MODE",
  "CLAUDE_RUNNER_SKIP_GIT_VERIFY",
  "NODE_OPTIONS",
];

export function sanitizeEnv(base) {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    // Subscription login only: an inherited key would silently bill an account.
    if (/^ANTHROPIC_.*(API_KEY|AUTH_TOKEN)$/.test(key)) { delete env[key]; continue; }
    if (key.startsWith("CLAUDE_CODE_") && !ENV_KEEP_EXACT.has(key)) delete env[key];
  }
  delete env.ANTHROPIC_API_KEY;
  for (const key of ENV_STRIP_EXACT) delete env[key];
  env.CLAUDE_CODE_ENTRYPOINT = "sdk-ts";
  return env;
}

/* ------------------------------------------------------------------ *
 * Tool policy
 * ------------------------------------------------------------------ */

/**
 * Read-only inspection tools the host approves without bothering the operator.
 * Silent by design (no notice): they are not commands, they run dozens of times
 * a session, and the env-file guard below is the one place where a read
 * actually matters.
 */
const AUTO_ALLOW_READONLY = new Set([
  "Read", "Glob", "Grep", "NotebookRead",
]);

/**
 * Skill / agent plumbing — how the wizard's own product gets invoked.
 *
 * The `*` ask-hook routes EVERY tool through this host, and v0.4 auto-allowed
 * only the read-only four plus the shell policy. So the first thing a run did
 * — reach for the `/onboarding` skill — could surface as a confirmation card
 * asking the operator's permission to run the very thing they pressed Start
 * for, and a decline killed the run before it began. The skill invocation IS
 * the product: it is never a question.
 *
 * Measured on claude 2.1.263: a slash-command invocation of `/onboarding`
 * loads inline and raises no tool call at all, but the model may equally reach
 * for the `Skill` tool, and neither shape may card. `Task` is the name in the
 * `system/init` tool list; `Agent` is the name the SAME dispatch arrives under
 * on the wire — both are listed because the wire is what this code sees.
 *
 * Allowing dispatch is not a hole: measured, a subagent's own `Bash` call
 * arrives here as its own `can_use_tool` and is policed like any other. None
 * of these tools writes, edits, or runs a shell itself — that is the line, and
 * `Write`/`Edit`/`Bash`/`PowerShell` never cross it by this route.
 *
 * Unlike the read-only four these DO emit a notice: they are rare, and "the
 * host let the assistant start itself" is exactly the kind of thing the
 * transparency ledger exists to say out loud.
 */
const AUTO_ALLOW_PLUMBING = new Set([
  "Skill", "Task", "Agent", "TodoWrite", "ToolSearch", "TaskOutput", "ListAgents",
]);

/**
 * `WebFetch` / `WebSearch` were auto-allowed until v0.5 and are NOT any more.
 * They were filed under "read-only", which is true of the local filesystem and
 * false of the internet: they reach off this machine, which is precisely the
 * thing the shell policy's loopback confinement refuses to wave through. A
 * card is the honest answer.
 */

/** Tools whose activity means "the agent is reading the project". */
const INSPECT_TOOLS = new Set(["Read", "Glob", "Grep", "NotebookRead"]);

/** The two names the shell tool goes by — Bash on POSIX, PowerShell on win32. */
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

/* ------------------------------------------------------------------ *
 * Safe-command policy.
 *
 * Forcing every command over the wire (above) would otherwise turn a check
 * run's dozen version probes into a dozen cards. So the host does the
 * classifying the CLI used to do — but conservatively, in the open, and with
 * a `notice` event per decision so the page can show a ledger of everything
 * that ran without a card.
 *
 * Two-stage on purpose: a command must (a) match a declared read-only prefix
 * AND (b) survive every veto. The vetoes run on the RAW string, before
 * whitespace is collapsed, so a newline cannot hide a second command.
 * ------------------------------------------------------------------ */

/**
 * Read-only diagnostics. A prefix matches the whole command or the command up
 * to a space — `node --version` never admits `node --version-of-doom`. A
 * prefix ending in a non-word character (the overlay's `curl -s localhost:`)
 * matches any continuation, because the vetoes are what bound those.
 */
const SAFE_PREFIXES = [
  // version / existence probes
  "node --version", "node -v",
  "npm --version", "npm -v",
  "npx --version",
  "python --version", "python -V",
  "python3 --version", "python3 -V",
  "py -3 --version", "py --version",
  "git --version",
  "claude --version",
  "docker --version",
  // "is this on PATH"
  "where", "which", "command -v", "Get-Command",
  // inert listings
  "npm ls",
  "ls", "dir", "Get-ChildItem",
  "echo",
  // loopback-only HTTP probes; the network veto below is what confines them
  "curl", "Invoke-WebRequest", "Invoke-RestMethod",
];

/** Commands that reach the network. Confined to loopback, GET only. */
const NETWORK_VERBS = new Set(["curl", "Invoke-WebRequest", "Invoke-RestMethod"]);

const LOOPBACK_HOSTS = /(?:^|[\s/@:"'=])(?:127\.0\.0\.1|localhost|\[::1\]|::1)(?::\d{1,5})?(?=[\s/:"']|$)/;
/** A dotted TLD is the cheap tell for "this is going off this machine". */
const OFF_MACHINE_HOST = /\b[a-z0-9][a-z0-9-]*\.[a-z]{2,}\b/i;
/** Flags that turn a probe into a download or a write. */
const NETWORK_WRITE_FLAGS =
  /(?:^|\s)(?:-o|-O|--output|--upload-file|-T|-d|--data\S*|-F|--form|-X|--request|-OutFile|-Method|-Body|-InFile)(?:\s|=|$)/i;

/**
 * …except discarding the body. `curl -s -o /dev/null -w "%{http_code}" <url>`
 * is THE canonical "is anything answering, and with what status" probe, and
 * v0.4 carded it because `-o` is on the download list. It is not a download:
 * the null device is the one output target that writes nowhere. Only the null
 * device — any other `-o` target is still a download and still cards.
 *
 * Case-sensitive on the short flag so curl's `-O` (write to the REMOTE name)
 * keeps its veto; the null device itself is matched case-insensitively because
 * `NUL` and `nul` are both real on Windows.
 */
const DISCARD_TO_NULL =
  /(?:^|\s)(?:-o|--output)(?:\s+|=)(?:\/dev\/null|[Nn][Uu][Ll])(?=\s|$)/g;

/**
 * A probe that already bounds how long it may wait. Anything else that reaches
 * the network gets one added — see `withNetworkTimeout`.
 */
const NETWORK_TIMEOUT_FLAGS =
  /(?:^|\s)(?:--max-time|--connect-timeout|-m|-TimeoutSec|-OperationTimeoutSeconds)(?:[\s=]|$)/i;

/** Seconds. Long enough for a loopback service, short enough to be a probe. */
const NETWORK_TIMEOUT_SECONDS = 4;

/**
 * A loopback GET against a port where nothing is listening does not always
 * fail fast — observed on this box against 127.0.0.1:8787, where a probe with
 * no timeout hung until the operator gave up, with the wizard showing a step
 * that would never finish. A probe without a bound is not a probe.
 *
 * The host therefore APPENDS the bound rather than silently refusing or
 * silently rewriting nothing: the notice says the timeout was added, and the
 * preamble warns the agent that the command which ran may not be byte-
 * identical to the one it wrote (measured: a model that sees an unexplained
 * rewrite reasonably reports it as a fault).
 */
function withNetworkTimeout(raw, verb) {
  const flag = verb === "curl"
    ? `--max-time ${NETWORK_TIMEOUT_SECONDS}`
    : `-TimeoutSec ${NETWORK_TIMEOUT_SECONDS}`;
  return `${String(raw).trimEnd()} ${flag}`;
}

/* ------------------------------------------------------------------ *
 * The python health probe.
 *
 * `python -c "import pipeline.jobfit.codegen"` is what the overlay declares
 * "the Python side is installed" is proven by, and it auto-allowed exactly as
 * written. What the agent actually ran was
 * `python -c "import pipeline.jobfit.codegen; print('ok')"` — one `;` inside a
 * quoted argument, which is not shell chaining at all, but the `;` veto reads
 * the RAW string (deliberately: that is what stops a newline hiding a second
 * command) and could not tell the difference. So a declared probe carded.
 *
 * The answer is not to soften the `;` veto. It is to PARSE this one shape:
 * an interpreter, `-c`, and a quoted payload that is a single `import` of a
 * dotted module, optionally followed by a `print` of a literal. Anything else
 * in the payload — `python -c "import os; os.system('x')"` — does not match,
 * falls through, and meets the veto exactly as before.
 *
 * Honest scope: importing a module runs that module's top-level code. This
 * class is a deliberate trade, made because the alternative was a card on the
 * single most common health probe in this project, and it is bounded by the
 * grammar below rather than by hoping the module is harmless.
 * ------------------------------------------------------------------ */

/** `python -c "<payload>"`, `python3 -c '<payload>'`, `py -3 -c "<payload>"`. */
const PYTHON_DASH_C = /^(python3?|py)((?:\s+-3)?)\s+-c\s+(?:"([^"]*)"|'([^']*)')$/;
/** One `import a.b.c`. No `as`, no comma list, no `from … import …`. */
const PYTHON_IMPORT = /^import\s+[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
/** `print('ok')` / `print("ok")` / `print(name)` — a literal, never a call. */
const PYTHON_PRINT = /^print\(\s*(?:"[^"'()]*"|'[^"'()]*'|[A-Za-z_]\w*)\s*\)$/;

/**
 * `{allowed:true, …}` for the import-probe shape, or `null` for "not this
 * shape, carry on classifying". Never returns a refusal — a non-match must
 * fall through to the ordinary vetoes, not short-circuit them.
 */
export function classifyPythonImportProbe(rawCommand) {
  const raw = String(rawCommand ?? "");
  // The vetoes this shape is allowed to skip are `;` and nothing else.
  if (/[\r\n`>|&]/.test(raw) || raw.includes("$(")) return null;
  const m = PYTHON_DASH_C.exec(normalizeCommand(raw));
  if (!m) return null;
  const payload = m[3] !== undefined ? m[3] : m[4];
  const statements = String(payload ?? "").split(";").map((s) => s.trim());
  if (statements.length < 1 || statements.length > 2) return null;
  if (!PYTHON_IMPORT.test(statements[0])) return null;
  if (statements.length === 2 && !PYTHON_PRINT.test(statements[1])) return null;
  return { allowed: true, reason: `python import probe (${statements[0]})` };
}

/**
 * Vetoes. Order matters only for the reason string. Every one of these wins
 * over any prefix match — that is the whole contract of this table.
 */
const HARD_BLOCKS = [
  [/[>|;&`]/, "a shell metacharacter (redirect, pipe, chain or backtick)"],
  [/\$\(/, "command substitution"],
  [/[\r\n]/, "more than one line"],
  [/(?:^|[\s"'/\\])\.env\b/i, "the env file"],
  [
    /\b(rm|del|erase|rmdir|Remove-Item|Move-Item|Copy-Item|Set-Content|Add-Content|Out-File|Clear-Content|New-Item|Invoke-Expression|iex|sudo|runas|taskkill|Stop-Process|Start-Process|chmod|chown|uninstall)\b/i,
    "a destructive or state-changing verb",
  ],
  [/(?:^|\s)--?force\b/i, "a --force flag"],
];

const MAX_COMMAND_LENGTH = 400;

/** Collapse whitespace for prefix matching. NEVER used for the vetoes. */
function normalizeCommand(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

function matchesPrefix(command, prefix) {
  if (!prefix) return false;
  if (command === prefix) return true;
  if (!command.startsWith(prefix)) return false;
  // A prefix that ends mid-word must be followed by a space; one that ends on
  // punctuation (`curl -s localhost:`) is already an open-ended shape.
  return command[prefix.length] === " " || !/[A-Za-z0-9_]/.test(prefix[prefix.length - 1]);
}

/**
 * Decide one shell command. `{allowed:false}` means "draw a card", never
 * "refuse" — the operator is always still able to say yes.
 *
 * An allowed verdict may carry `command`: the string the host wants RUN in
 * place of the one the agent wrote (today, only a network probe gaining a
 * timeout). It is never a silent substitution — the caller allows with that as
 * `updatedInput` and says so on the ledger.
 */
export function classifyCommand(rawCommand, extraPrefixes = []) {
  const raw = String(rawCommand ?? "");
  const command = normalizeCommand(raw);
  if (!command) return { allowed: false, reason: "empty command" };
  if (raw.length > MAX_COMMAND_LENGTH) return { allowed: false, reason: "unusually long" };

  // Parsed, not vetoed: the one shape where a `;` is punctuation inside a
  // quoted argument rather than shell chaining. A non-match returns null and
  // meets every veto below untouched.
  const pythonProbe = classifyPythonImportProbe(raw);
  if (pythonProbe) return pythonProbe;

  for (const [re, why] of HARD_BLOCKS) {
    if (re.test(raw)) return { allowed: false, reason: `mentions ${why}` };
  }

  const verb = command.split(" ")[0];
  let rewritten = null;
  if (NETWORK_VERBS.has(verb)) {
    // Discarding the body to the null device is a status probe, not a
    // download, so it is removed before the download flags are looked for.
    if (NETWORK_WRITE_FLAGS.test(command.replace(DISCARD_TO_NULL, " "))) {
      return { allowed: false, reason: "not a plain GET" };
    }
    if (!LOOPBACK_HOSTS.test(command)) return { allowed: false, reason: "no loopback host" };
    if (OFF_MACHINE_HOST.test(command.replace(/\.(exe|ps1|mjs|js|py|json|txt|md)\b/gi, ""))) {
      return { allowed: false, reason: "reaches beyond this machine" };
    }
    if (!NETWORK_TIMEOUT_FLAGS.test(command)) rewritten = withNetworkTimeout(raw, verb);
  }

  const allow = (reason) => (rewritten ? { allowed: true, reason, command: rewritten } : { allowed: true, reason });
  for (const prefix of SAFE_PREFIXES) {
    if (matchesPrefix(command, prefix)) return allow(`read-only probe (${prefix})`);
  }
  for (const prefix of extraPrefixes) {
    if (matchesPrefix(command, prefix)) return allow(`declared probe (${prefix})`);
  }
  return { allowed: false, reason: "not on the read-only list" };
}

/* ------------------------------------------------------------------ *
 * The overlay's declared probes.
 *
 * `.claude/onboarding/config.md` already states, in a markdown table, the
 * exact command each runtime prerequisite is checked with. Re-deriving that
 * list here would make it drift, so it is READ at spawn — the wizard trusts
 * the repo's own committed overlay the way it trusts its own source. The
 * vetoes above still apply to every one of them.
 * ------------------------------------------------------------------ */

const MAX_OVERLAY_PROBES = 40;

function splitTableRow(line) {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function parseProbeTable(markdown) {
  const out = [];
  const seen = new Set();
  let column = -1;
  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) { column = -1; continue; }
    const cells = splitTableRow(trimmed);
    if (column < 0) {
      const at = cells.findIndex((c) => /^probe\s+command$/i.test(c));
      if (at >= 0) column = at;
      continue;
    }
    // The header's own `| --- | --- |` underline.
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    for (const match of (cells[column] ?? "").matchAll(/`([^`]+)`/g)) {
      // `<port>` and friends are placeholders: keep the head as an open prefix.
      const cut = match[1].indexOf("<");
      const candidate = normalizeCommand(cut >= 0 ? match[1].slice(0, cut) : match[1]);
      if (!candidate || candidate.length > MAX_COMMAND_LENGTH) continue;
      // A bare path (`node_modules/`) is a fact, not a command.
      const verb = candidate.split(" ")[0];
      if (!/^[A-Za-z][A-Za-z0-9_.+-]*$/.test(verb)) continue;
      // A declared probe still has to survive the vetoes.
      if (HARD_BLOCKS.some(([re]) => re.test(candidate))) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
      if (out.length >= MAX_OVERLAY_PROBES) return out;
    }
  }
  return out;
}

export function overlayProbeCommands() {
  const file = path.join(REPO_ROOT, ".claude", "onboarding", "config.md");
  if (!existsSync(file)) return [];
  try {
    return parseProbeTable(readFileSync(file, "utf8"));
  } catch {
    // No overlay, or an unreadable one: every probe simply becomes a card.
    return [];
  }
}

/** First `max` characters of a command, for a notice line. */
function clip(text, max = 80) {
  const t = normalizeCommand(text);
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/* ------------------------------------------------------------------ *
 * Env-file read guard.
 *
 * The host owns secret VALUES: it writes them and answers the agent with a
 * bare "<NAME> is set". That contract has one hole — Read/Grep/Glob are
 * auto-allowed, so nothing stopped the agent from simply opening .env.local
 * and pulling every value into model context. These tools are therefore denied
 * server-side whenever their path or pattern names the env file (or a bare
 * `.env`), silently: it is a host policy, not a decision for the operator.
 * `.env.example` carries no values and stays readable — it is the variable
 * catalogue the skill needs.
 * ------------------------------------------------------------------ */

const ENV_GUARD_TOOLS = new Set(["Read", "Grep", "Glob", "NotebookRead"]);
const ENV_GUARD_MESSAGE =
  "The host manages the env file — use the HOST INVENTORY in your instructions.";

/** Does this basename (possibly a glob) name a value-carrying env file? */
export function isProtectedEnvName(raw) {
  const base = String(raw ?? "").trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!base) return false;
  if (base === ".env.example") return false;
  if (base === ENV_BASENAME || base === ".env") return true;
  // Globs: `.env*`, `.env.*`, `.env.?ocal` — anything that would sweep the
  // real file in. `.env.example` is already excluded above, and a glob that
  // matches it also matches the real one, so denying is correct.
  return /^\.env(\.[A-Za-z0-9_*?[\]-]+)?[*?]?$/.test(base) && base !== ".env.example";
}

/** Every path-ish token in a tool input that could resolve to the env file. */
function targetsEnvFile(toolName, input) {
  if (!ENV_GUARD_TOOLS.has(toolName)) return false;
  const candidates = [
    input?.file_path, input?.path, input?.notebook_path, input?.pattern, input?.glob,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate) continue;
    const normalized = candidate.replace(/\\/g, "/");
    for (const token of normalized.split(/[\s,{}()|]+/)) {
      if (!token) continue;
      if (isProtectedEnvName(token.split("/").pop())) return true;
    }
  }
  return false;
}

/**
 * A ledger line for a plumbing call. `Skill (onboarding)` reads as something
 * that happened; the raw input object reads as a leak.
 */
function plumbingLabel(toolName, input) {
  const hint = input?.skill ?? input?.subagent_type ?? input?.description ?? "";
  const text = typeof hint === "string" ? hint.trim() : "";
  return text ? `${toolName} (${clip(text, 60)})` : toolName;
}

/** Plain-language framing for the confirm card, per tool. */
function describeAsk(toolName, input) {
  // Bash on POSIX, PowerShell on Windows — both carry `command`.
  if (toolName === "Bash" || toolName === "PowerShell") {
    return { verb: "run a command", detail: String(input?.command ?? ""), note: input?.description ?? "" };
  }
  if (toolName === "Write") {
    return { verb: "create a file", detail: String(input?.file_path ?? ""), note: "" };
  }
  if (toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") {
    return { verb: "edit a file", detail: String(input?.file_path ?? ""), note: "" };
  }
  return { verb: `use the ${toolName} tool`, detail: JSON.stringify(input ?? {}, null, 2), note: "" };
}

/**
 * Key for "the operator already said yes to exactly this, this run".
 *
 * EXACT, deliberately. Its predecessor was a SHAPE key — `Write:<path>`
 * ignored the content, `Bash:<command>` was widened by an "always allow"
 * button the operator had to press. Both of those traded protection for
 * quiet. This one repeats a decision the operator already made for a byte-
 * identical call and widens nothing, so it needs no button and has none.
 */
function exactKey(toolName, input) {
  if (SHELL_TOOLS.has(toolName)) return `${toolName}:${normalizeCommand(input?.command ?? "")}`;
  return `${toolName}:${JSON.stringify(input ?? {})}`;
}

/* ------------------------------------------------------------------ *
 * Host markers — the agent's channel for structured events.
 *
 * The page is a status board, not a transcript, so the narration alone is not
 * enough: the host needs to know which phase is running, which probe passed and
 * which port the booted app answers on. The agent emits those as marker lines
 * inside its ordinary prose; the host strips the line and re-emits it as a
 * typed SSE event, so the operator never sees the syntax.
 * ------------------------------------------------------------------ */

const MARKER_RE = /^\s*\[\[wizard:([a-z]+)((?:\s+[a-z]+=(?:"[^"]*"|[^\s\]]+))*)\s*\]\]\s*$/;
/**
 * Phase ids used to be a closed set (welcome, mode, checks, capabilities, boot,
 * voice, done). Since v0.3 the recon-first run DECLARES its own steps with a
 * plan marker, so the host validates the SHAPE and lets the plan name the
 * vocabulary; `check` and single-group runs still emit the legacy ids, which
 * are slug-shaped and pass unchanged.
 */
const PHASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PROBE_STATES = new Set(["ok", "fail", "warn", "running"]);
/** A plan rail longer than this is a runaway, not a journey. */
const MAX_PLAN_STEPS = 12;

function parseMarkerAttrs(raw) {
  const out = {};
  const re = /([a-z]+)=(?:"([^"]*)"|([^\s\]]+))/g;
  let m;
  while ((m = re.exec(raw))) out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return out;
}

/** `"assess:Looking around,done:Your install"` → `[{id,label}, …]`. */
function parsePlanSteps(raw) {
  const steps = [];
  const seen = new Set();
  for (const part of String(raw ?? "").split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const cut = piece.indexOf(":");
    const id = (cut >= 0 ? piece.slice(0, cut) : piece).trim().toLowerCase();
    const label = (cut >= 0 ? piece.slice(cut + 1) : piece).trim();
    if (!PHASE_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    steps.push({ id, label: label || id });
    if (steps.length >= MAX_PLAN_STEPS) break;
  }
  return steps;
}

/* ------------------------------------------------------------------ *
 * Host inventory — the cheap facts the agent would otherwise have to go
 * looking for, and the ONE fact (which variables carry a value) it is not
 * allowed to look for at all.
 *
 * Names only, never values: the whole point is that the agent can reason about
 * which capability groups are already configured without a secret ever
 * entering model context.
 * ------------------------------------------------------------------ */

/** Names of variables in the env file that have a non-empty value. NEVER values. */
function envVarNames() {
  const names = [];
  const seen = new Set();
  for (const line of readEnvLines()) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    if (m[2].trim() === "") continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    names.push(m[1]);
  }
  return names;
}

/** kp's conventional dev port — the fallback probe when no lock names one. */
const DEFAULT_DEV_PORT = 3000;

/** The port Next's dev-guard lock names, if it names one. */
function devLockPort() {
  const lockPath = path.join(REPO_ROOT, ".next", "dev", "lock");
  if (!existsSync(lockPath)) return { present: false, port: null };
  let raw = "";
  try { raw = readFileSync(lockPath, "utf8"); } catch { return { present: true, port: null }; }
  // The lock's shape is Next's, not ours, and it has changed across canaries:
  // accept JSON with a port field, a `port=`/`port:` line, or a bare number.
  let port = null;
  try {
    const parsed = JSON.parse(raw);
    for (const key of ["port", "appPort", "devPort"]) {
      const n = Number(parsed?.[key]);
      if (Number.isInteger(n) && n > 0 && n <= 65535) { port = n; break; }
    }
  } catch { /* not JSON — fall through to the text shapes */ }
  if (port === null) {
    const m = /port"?\s*[:=]\s*"?(\d{2,5})/i.exec(raw) || /^\s*(\d{2,5})\s*$/.exec(raw);
    const n = m ? Number(m[1]) : NaN;
    if (Number.isInteger(n) && n > 0 && n <= 65535) port = n;
  }
  return { present: true, port };
}

/** Does anything answer /api/health on that port? ~1s, never throws. */
async function probeHealth(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1200) });
    return { answered: true, status: r.status };
  } catch {
    return { answered: false, status: null };
  }
}

async function hostInventory() {
  const names = envVarNames();
  const lock = devLockPort();
  let devLine;
  if (lock.port === null) {
    // No lock, or a lock that names no port. One cheap probe of the default dev
    // port still separates "nothing is running" from "something is running that
    // dev-guard did not record" — a `next start`, or a dev server launched
    // outside the guard. Both are real states on a developer's machine and the
    // agent must not re-boot over either.
    const fallback = await probeHealth(DEFAULT_DEV_PORT);
    const lockNote = lock.present
      ? ".next/dev/lock exists but names no port"
      : "no .next/dev/lock";
    devLine = fallback.answered
      ? `${lockNote}, but SOMETHING answers /api/health on :${DEFAULT_DEV_PORT} (HTTP ${fallback.status}). Without the lock the host cannot tell whether that is THIS checkout or another app on this machine — confirm which before you treat it as running, and if it is this app do not boot or restart it.`
      : `${lockNote}, and nothing answered on :${DEFAULT_DEV_PORT} — treat this app as not running.`;
  } else {
    const health = await probeHealth(lock.port);
    devLine = health.answered
      ? `.next/dev/lock names port ${lock.port} and an app ANSWERS on :${lock.port} (GET /api/health -> ${health.status}). The app is already running: do not boot or restart it unless you changed something that needs a restart.`
      : `.next/dev/lock names port ${lock.port} but NOTHING answered there — a stale lock. Treat the app as not running.`;
  }
  return [
    "HOST INVENTORY — facts the installer host computed on this machine at startup.",
    "Treat these as ground truth and do not re-derive them.",
    "",
    `- Repository: ${REPO_ROOT}`,
    `- Env file (${ENV_FILE}): ${existsSync(ENV_FILE) ? "present" : "ABSENT — nothing has been configured here yet"}.`,
    `- Variables in the env file that hold a non-empty value — NAMES ONLY: ${names.length ? names.join(", ") : "(none)"}.`,
    "  Their VALUES are deliberately withheld. You must never open, read, grep or print the env",
    "  file: the host's permission layer denies it, and a value in your context is the exact leak",
    "  this wizard exists to prevent. A name in that list means the variable is SET; use that to",
    "  decide which capability groups are already configured, and verify them by their read-only",
    "  probes rather than by looking at the file.",
    `- .env.example: ${existsSync(path.join(REPO_ROOT, ".env.example")) ? "present (readable — it carries no values)" : "absent"}.`,
    `- node_modules/: ${existsSync(path.join(REPO_ROOT, "node_modules")) ? "present — dependencies are installed" : "ABSENT — npm install has not been run"}.`,
    `- data/kp.sqlite: ${existsSync(path.join(REPO_ROOT, "data", "kp.sqlite")) ? "present — this install has a database already" : "absent — a fresh database will self-seed the demo corpus on first boot"}.`,
    `- Dev server: ${devLine}`,
    "",
    "END HOST INVENTORY",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * The wizard-mode preamble — the contract that keeps the fleet-shared
 * registry skill unedited.
 * ------------------------------------------------------------------ */

/** The recon-first flow, appended only for the default (`start`) run. */
function reconContract() {
  return [
    "7. RECON FIRST — this run does NOT open with the skill's step 0, and it does NOT assume a",
    "   fresh clone. Before you ask the operator anything:",
    "   a) ASSESS SILENTLY. Emit [[wizard:phase id=assess]] and work out where THIS install",
    "      actually is, from the HOST INVENTORY below plus the skill's read-only runtime probes,",
    "      plus — for every capability group whose variables the inventory shows as SET — that",
    "      group's check-mode verify probe. Ask NOTHING during assessment and spend nothing:",
    "      read-only commands only, no paid API calls. Keep emitting [[wizard:status …]] and",
    "      [[wizard:probe …]] as you go, and keep the narration to a couple of short lines.",
    "      A group's verify probe is CONDITIONAL on its service actually running: a configured",
    "      variable pointing at a local port proves the wiring, not that anything is listening",
    "      there. Bound every such probe with a timeout (above), and treat \"nothing answered\" as a",
    "      finding to report — status warn, and say what would start it — never as a reason to wait.",
    "   b) CLASSIFY, THEN OFFER A JOURNEY. From what you found, classify this install as exactly",
    "      one of:",
    "        fresh    — dependencies and/or the env file are largely absent; a new clone.",
    "        addon    — a working install where some capability groups are simply unconfigured.",
    "        repair   — something that WAS configured now fails its verify. Name what, and why.",
    "        complete — everything configured verifies, and nothing obvious is missing.",
    "      Then ask ONE AskUserQuestion with header \"Journey\" whose options are GENERATED FROM",
    "      YOUR FINDINGS — concrete and honest, never a generic menu. Shapes that are right:",
    "      \"Add voice interviews (not configured)\", \"Fix CV analysis (GEMINI_API_KEY is set but",
    "      the analysis probe fails)\", \"Just show my capability matrix\", \"Run the full setup",
    "      anyway\". Each description says what the option will do and what it will ask of them.",
    "      On the `complete` journey go MATRIX-FIRST: put \"Just show my capability matrix\" first",
    "      and recommend it, and print the matrix immediately if it is chosen.",
    "      Ask the skill's install-mode question (developer laptop / team self-host / just",
    "      evaluating) ONLY on the `fresh` journey — on any other journey this machine has",
    "      already answered it, and asking again is the bug this contract exists to fix.",
    "   c) DECLARE THE PLAN. Immediately after the journey answer, emit ONE [[wizard:plan …]]",
    "      marker naming the steps this journey will really walk, ending in `done`, and use those",
    "      ids in every later [[wizard:phase]]. If the operator later picks a different group and",
    "      the journey changes, emit a fresh plan marker for the new steps.",
    "   d) THEN WALK IT. Everything after that follows the onboarding skill and the contracts",
    "      above: capability groups in batches, secret VALUES only ever through the host, the",
    "      voice phase only when spoken output is actually in scope, the capability matrix at the",
    "      end. Boot verify runs ONLY when the boot state is unknown or when something you",
    "      changed needs a restart — if the HOST INVENTORY says an app already answers on a port,",
    "      emit [[wizard:app port=N]] with that port and move on; do not restart it. On a",
    "      matrix-only journey, skip boot verify altogether.",
    "",
  ].join("\n");
}

function preamble(run) {
  return [
    "You are running as the ENGINE of the kp installer wizard: a local browser UI, not a terminal.",
    "A non-technical operator is watching a web page, not a transcript. Adapt as follows:",
    "",
    "1. SECRETS. When you need the VALUE of an API key, token or password, you must NOT ask the",
    "   operator to paste it into the conversation, and you must never run a command that would",
    "   print one. Instead call the AskUserQuestion tool with header \"Secret\" and a question whose",
    "   text names the EXACT environment variable, one variable per question — for example",
    "   \"Enter a value for GEMINI_API_KEY\" with options \"Paste the value\" and \"Skip for now\".",
    "   The host renders a masked field, writes the value into .env.local ITSELF, and answers you",
    "   with only \"<NAME> is set (written by the installer host — do not read or echo its value)\",",
    "   \"<NAME> kept\" or \"<NAME> skipped\". Treat that as the whole truth: never read the file back",
    "   to check, never echo, never confirm a prefix or a length.",
    "2. QUESTIONS. Every choice you need from the operator goes through AskUserQuestion, never as a",
    "   plain-text question in your narration — a question in prose will not be seen as answerable.",
    "3. NARRATION. Keep it short and in plain language: what you are doing and what it means for",
    "   them. Markdown tables render properly, so keep the probe table and the final capability",
    "   matrix as markdown tables.",
    "4. PERMISSIONS. EVERY command you run is seen by the installer host — there is no command that",
    "   slips past it. The host settles read-only diagnostics itself (version probes, `where`, a",
    "   plain directory listing, a loopback HTTP GET, and the probe commands this project declares)",
    "   and tells the operator it did so; everything else becomes a confirmation card they must",
    "   click. So: state plainly in your narration why a step is needed before you attempt it, and",
    "   RUN PROBES ONE COMMAND AT A TIME. Chaining probes with `;`, `&&` or a pipe turns three",
    "   things the host would have waved through into one card the operator has to read and approve",
    "   — it is slower for them, not faster. Redirects, pipes and shell chaining never auto-allow,",
    "   including a PowerShell formatting pipe: to read a local endpoint use a bare",
    "   `curl -s http://localhost:<port>/<path>`, not `Invoke-WebRequest … | Select-Object …`.",
    "   RUN A DECLARED PROBE VERBATIM. Where this project's overlay states the exact command a",
    "   prerequisite is checked with, run THAT STRING and nothing else. Embellishing it — appending",
    "   `; print('ok')` to an import check, tacking a second check on the end — turns a command the",
    "   host had already been told to expect into a card the operator must read. If you need more",
    "   output than the declared probe gives you, run a SECOND probe of the same declared shape.",
    "   EVERY NETWORK PROBE CARRIES AN EXPLICIT TIMEOUT. A loopback GET against a port where",
    "   nothing is listening can hang for minutes, and the page just sits on a step that never",
    "   finishes. Write `curl -s --max-time 4 http://localhost:<port>/<path>` — or",
    "   `Invoke-WebRequest -TimeoutSec 4 …` — every time, including a status-only probe such as",
    "   `curl -s -o /dev/null -w \"%{http_code}\" --max-time 4 http://127.0.0.1:<port>/`, which the",
    "   host recognises as a probe rather than a download. If you forget, the host appends the",
    "   timeout for you and records that it did; the command that RAN is then not byte-identical to",
    "   the one you wrote, which is expected and is not a sign that anything has gone wrong.",
    "5. HOST MARKERS. The page shows status cards, not a log, so emit these marker lines inside your",
    "   narration — each ON ITS OWN LINE, never inside a code fence or a table. The host strips the",
    "   line before anything is displayed, so the operator never sees the syntax.",
    "   - [[wizard:plan steps=\"assess:Looking around,voice:Voice interviews,done:Your install\"]]",
    "     declares the step plan for the journey you are about to walk: comma-separated id:Label",
    "     pairs, ids lowercase slugs, labels two or three plain words. The page draws it as the",
    "     progress rail, so name the steps you will ACTUALLY walk — no aspirational ones — and",
    "     always end with done. Emit a fresh plan marker if the journey changes mid-run.",
    "   - [[wizard:phase id=checks]] whenever you move to a new stage. Use the ids from your own",
    "     plan marker; when you have not declared a plan, use the fixed set: welcome, mode (the",
    "     install-mode question), checks (runtime prerequisites), capabilities (the capability",
    "     groups), boot (boot verify), voice (the spoken-output check), done (the final matrix).",
    "   - [[wizard:status text=\"Checking Python\"]] one short present-tense line whenever what you",
    "     are doing changes.",
    "   - [[wizard:probe name=\"node\" status=ok detail=\"v24.14\"]] once per runtime probe. status is",
    "     one of ok, fail, warn, running.",
    "   - [[wizard:app port=3000]] as soon as boot verify knows the LIVE port — read it off the",
    "     dev-guard banner, never assume 3000.",
    "   - [[wizard:matrix]] on the line immediately BEFORE the final capability matrix. Everything",
    "     after it in that message is taken as the matrix, so put nothing else after the table.",
    "6. SPOKEN-OUTPUT CHECK. When boot verify succeeds: emit [[wizard:app port=N]], then",
    "   [[wizard:phase id=voice]], then say in ONE plain sentence that the wizard now offers a quick",
    "   spoken-output check in the page, which the operator can also skip. Then STOP and wait: the",
    "   host runs that check itself and sends you a user message with the outcome (\"the operator",
    "   chose <provider>…\" or \"…skipped by the operator\"). Do not print the final capability matrix",
    "   before that message arrives, and do not ask about it with AskUserQuestion. If the app failed",
    "   to boot, skip the voice phase entirely and go straight to the matrix.",
    "",
    ...(isStartRun(run) ? [reconContract()] : []),
    "For everything else follow the onboarding skill exactly as written.",
    "",
  ].join("\n");
}

/** The recon-first default run. `full` is the pre-v0.3 name for the same thing. */
function isStartRun(run) {
  return run === "start" || run === "full";
}

function invocationFor(run) {
  if (isStartRun(run)) return "/onboarding";
  if (run === "check") return "/onboarding check";
  return `/onboarding ${run}`;
}

/* ------------------------------------------------------------------ *
 * .env.local merge — the host owns secret values, the agent never sees them.
 * ------------------------------------------------------------------ */

function readEnvLines() {
  if (!existsSync(ENV_FILE)) return [];
  return readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
}

function envValueOf(name) {
  for (const line of readEnvLines()) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m && m[1] === name) return m[2];
  }
  return undefined;
}

function envHasValue(name) {
  const v = envValueOf(name);
  return v !== undefined && v.trim() !== "";
}

/**
 * Merge one variable into .env.local, preserving every existing line.
 * Returns "created" | "appended" | "replaced" | "exists".
 */
export function mergeEnv(name, value, { overwrite = false } = {}) {
  const existing = envValueOf(name);
  if (existing !== undefined && existing.trim() !== "" && !overwrite) return "exists";
  const serialized = `${name}=${value}`;
  if (!existsSync(ENV_FILE)) {
    writeFileSync(ENV_FILE, `${serialized}\n`, { encoding: "utf8", mode: 0o600 });
    return "created";
  }
  const lines = readEnvLines();
  const idx = lines.findIndex((l) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
    return m && m[1] === name;
  });
  if (idx >= 0) {
    lines[idx] = serialized;
    writeFileSync(ENV_FILE, lines.join("\n"), "utf8");
    return "replaced";
  }
  const needsNewline = lines.length > 0 && lines[lines.length - 1] !== "";
  appendFileSync(ENV_FILE, `${needsNewline ? "\n" : ""}${serialized}\n`, "utf8");
  return "appended";
}

/** Does the configured env file exist right now? (For the `hello` payload.) */
export function envFileExists() {
  return existsSync(ENV_FILE);
}

/* ------------------------------------------------------------------ *
 * Session
 *
 * One run, one Session, however many faces are watching. Everything a face
 * needs in order to render is held HERE rather than in a connection: the
 * pending cards, the phase, the plan, and a bounded replay buffer. A client
 * that connects late (the studio, a reloaded page, a second browser) is handed
 * that state in `hello` and is then indistinguishable from one that was there
 * all along — see `replayState()` and PROTOCOL.md "Rejoining a live session".
 * ------------------------------------------------------------------ */

/** How many notices / narration blocks a late joiner is handed. */
const REPLAY_LIMIT = 20;
/** How many probe rows survive in the replay buffer (one per name). */
const REPLAY_PROBE_LIMIT = 60;

export class Session {
  constructor(broadcast) {
    this.broadcast = broadcast;
    this.child = null;
    this.buffer = "";
    /** request_id -> { toolName, input, tool_use_id, … } awaiting a UI decision. */
    this.pendingAsks = new Map();
    /** card id -> { requestId, question, secret, envName } for AskUserQuestion items. */
    this.pendingItems = new Map();
    /** exactKey of every call the OPERATOR allowed this run — no shapes, no button. */
    this.approvedExact = new Set();
    /** The overlay's declared probe commands, read once at spawn. */
    this.probePrefixes = [];
    /** tool_use_ids the host was actually asked about. */
    this.askedToolUseIds = new Set();
    /** tool_use_id -> command, for shell runs no can_use_tool ever mentioned. */
    this.unverifiedRuns = new Map();
    this.running = false;
    this.seq = 0;
    /** Bumped on every start/stop; stale child handlers check it and no-op. */
    this.runId = 0;
    this.phase = null;
    this.lastStatus = "";
    this.appPort = APP_PORT_OVERRIDE;
    this.stderrTail = "";
    /** The agent-declared step rail, or null before the first plan marker. */
    this.plan = null;

    /* -------- the replay buffer: what a face that joins late is handed -------
       Every entry is the VERBATIM event that was broadcast, `seq` and `at`
       included, so a client feeds a replayed event through exactly the handler
       it uses for a live one, and can drop anything at or below the highest
       `seq` it has already processed. That last property is what makes an
       EventSource auto-reconnect idempotent instead of a duplicate render. */
    /** card id -> the question/secret/permission event that opened it. */
    this.openCards = new Map();
    /** probe name -> its latest `probe` event (a probe row is a replacement). */
    this.probeRows = new Map();
    /** The last REPLAY_LIMIT `notice` / `narration` events. */
    this.recentNotices = [];
    this.recentNarration = [];
    /** The final capability matrix, once it has been emitted. */
    this.matrixMd = null;
    /** The last `done` / `stopped` / `error` event — how the last run ended. */
    this.terminalEvent = null;
  }

  emit(type, payload) {
    const event = { type, seq: ++this.seq, at: Date.now(), ...payload };
    this.remember(event);
    this.broadcast(event);
  }

  /**
   * Fold one outgoing event into the replay buffer. Deliberately a pure
   * bookkeeping step on the way OUT: an event a face never sees is one that
   * was never remembered either, so the replay cannot drift from the stream.
   */
  remember(ev) {
    switch (ev.type) {
      case "question": case "secret": case "permission":
        // A re-emitted card (the secret three-way discovering `alreadySet`)
        // REPLACES its predecessor under the same id, exactly as the page does.
        this.openCards.set(String(ev.id), ev);
        break;
      case "probe":
        if (this.probeRows.size >= REPLAY_PROBE_LIMIT && !this.probeRows.has(ev.name)) break;
        this.probeRows.set(String(ev.name), ev);
        break;
      case "notice":
        this.recentNotices.push(ev);
        if (this.recentNotices.length > REPLAY_LIMIT) this.recentNotices.shift();
        break;
      case "narration":
        this.recentNarration.push(ev);
        if (this.recentNarration.length > REPLAY_LIMIT) this.recentNarration.shift();
        break;
      case "matrix": this.matrixMd = String(ev.md ?? ""); break;
      case "done": case "stopped": case "error": this.terminalEvent = ev; break;
      default: break;
    }
  }

  /**
   * A card is no longer open. Announcing it is what lets a SECOND face drop a
   * card the operator answered on the first one — the decision has always been
   * server-side, but until v0.6 nothing on the wire said so, and the other face
   * was left holding a live-looking control that would never be heard again.
   *
   * `outcome` is a machine word, not page copy: `answered` `saved` `kept`
   * `skipped` `allowed` `declined` `withdrawn`. `answer` rides along for a
   * question so the other face can show what was picked.
   */
  closeCard(id, kind, outcome, answer) {
    const key = String(id);
    if (!this.openCards.has(key)) return;
    this.openCards.delete(key);
    this.emit("resolved", { id: key, kind, outcome, ...(answer != null ? { answer } : {}) });
  }

  /**
   * Everything a face needs to render a run it did not watch from the start.
   * Ordering is the render order: plan and phase first (they decide which
   * panels exist), then the evidence, then the open cards, then how it ended.
   */
  replayState() {
    return {
      status: this.lastStatus || "",
      probes: [...this.probeRows.values()],
      narration: [...this.recentNarration],
      notices: [...this.recentNotices],
      cards: [...this.openCards.values()],
      matrix: this.matrixMd,
      terminal: this.terminalEvent,
      seq: this.seq,
    };
  }

  /**
   * Relay into the booted app. The wizard server is the only process that knows
   * the port boot verify reported, and it is reachable from both faces, so the
   * proxy stays here even though the studio page could reach the app directly.
   */
  async appFetch(pathname, init = {}, timeoutMs = 8000) {
    const port = this.appPort;
    if (!port) {
      const err = new Error("The app has not reported a port yet — finish boot verify first.");
      err.noPort = true;
      throw err;
    }
    return await fetch(`http://127.0.0.1:${port}${pathname}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  /** One-line "what is happening now", deduped against the previous one. */
  status(text) {
    const t = String(text || "").trim();
    if (!t || t === this.lastStatus) return;
    this.lastStatus = t;
    this.emit("status", { text: t });
  }

  /**
   * Phase ids are free-form since v0.3 — the recon-first run declares its own
   * with a plan marker — so the only gate is the slug shape. `check` and
   * single-group runs keep emitting the legacy fixed ids, which still pass.
   */
  setPhase(id) {
    if (!PHASE_ID_RE.test(id) || this.phase === id) return;
    this.phase = id;
    this.emit("phase", { id });
  }

  /**
   * The transparency ledger. Anything the host settled WITHOUT a card says so
   * here, so "we did not bother you" never means "you were not told".
   */
  notice(kind, text) {
    const t = String(text || "").trim();
    if (!t) return;
    this.emit("notice", { kind, text: t });
  }

  /** A declared step rail. Re-emitted whenever the journey changes mid-run. */
  setPlan(steps) {
    if (!steps.length) return;
    this.plan = steps;
    this.emit("plan", { steps });
  }

  setAppPort(port) {
    const n = Number(port);
    if (!Number.isInteger(n) || n <= 0 || n > 65535) return;
    this.appPort = n;
    this.emit("app", { port: n });
  }

  async start(run) {
    if (this.running) return { ok: false, error: "A session is already running. Stop it first." };
    // Computed BEFORE the child exists so the very first message the agent sees
    // already says where this install is — the recon-first flow depends on it.
    let inventory;
    try {
      inventory = await hostInventory();
    } catch (err) {
      inventory = `HOST INVENTORY unavailable (${err.message}) — probe the install yourself, but still never read the env file.\n\n`;
    }
    if (this.running) return { ok: false, error: "A session is already running. Stop it first." };
    const cliPath = process.env.KP_CLAUDE_CLI || "claude";
    const args = buildArgs();
    // Belt and braces: the same assertion the launch self-check runs, re-run on
    // the argv this spawn will actually use. A session must never start weaker
    // than the process promised at startup.
    const problems = assertEnforcement(args);
    if (problems.length) {
      return { ok: false, error: `Refusing to start — permission enforcement is not intact: ${problems.join(" ")}` };
    }
    const env = sanitizeEnv(process.env);

    // Fresh state BEFORE the child exists, so a restart never inherits the last
    // run's pending cards, allow-list or phase.
    const runId = ++this.runId;
    this.buffer = "";
    this.pendingAsks.clear();
    this.pendingItems.clear();
    this.approvedExact.clear();
    this.askedToolUseIds.clear();
    this.unverifiedRuns.clear();
    this.probePrefixes = overlayProbeCommands();
    this.phase = null;
    this.lastStatus = "";
    this.stderrTail = "";
    this.appPort = APP_PORT_OVERRIDE;
    this.plan = null;
    // The replay buffer is per-RUN: a face joining the second run must not be
    // handed the first one's probes, matrix or terminal event.
    this.openCards.clear();
    this.probeRows.clear();
    this.recentNotices = [];
    this.recentNarration = [];
    this.matrixMd = null;
    this.terminalEvent = null;

    let child;
    try {
      const useShell = process.platform === "win32" && !path.isAbsolute(cliPath);
      child = spawn(cliPath, useShell ? args.map(quoteForShell) : args, {
        cwd: REPO_ROOT, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
        shell: useShell,
      });
    } catch (err) {
      return { ok: false, error: `Could not start the Claude CLI (${cliPath}): ${err.message}` };
    }
    this.child = child;
    this.running = true;

    child.stdout.on("data", (d) => { if (this.runId === runId) this.onStdout(d); });
    child.stderr.on("data", (d) => {
      if (this.runId !== runId) return;
      // Never broadcast: a stray stderr line could carry anything. Kept only to
      // explain a non-zero exit, and capped.
      this.stderrTail = (this.stderrTail + String(d)).slice(-2000);
    });
    child.on("error", (err) => {
      if (this.runId !== runId) return;
      this.running = false;
      this.emit("error", { message: `Claude CLI failed to start: ${err.message}` });
      this.emit("done", { exitCode: null });
    });
    child.on("exit", (code) => {
      if (this.runId !== runId) return;
      this.running = false;
      this.child = null;
      this.failPending("The setup assistant exited.");
      if (code) {
        this.emit("error", { message: this.stderrTail.trim() || `The setup assistant exited with code ${code}.` });
      }
      this.emit("done", { exitCode: code });
    });

    this.setPhase(isStartRun(run) ? "assess" : "welcome");
    this.status(`Starting the setup assistant (${invocationFor(run)})…`);
    this.write({ request_id: randomBytes(8).toString("hex"), type: "control_request", request: { subtype: "initialize" } });
    this.sendUser(`${preamble(run)}${inventory}${invocationFor(run)}`);
    return { ok: true };
  }

  write(obj) {
    if (!this.child || this.child.stdin.writableEnded) return;
    try {
      this.child.stdin.write(JSON.stringify(obj) + "\n");
    } catch {
      // A closed pipe means the session is gone; the exit handler reports it.
    }
  }

  sendUser(text) {
    this.write({
      type: "user",
      session_id: "",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
    });
  }

  respond(requestId, response) {
    this.write({ type: "control_response", response: { subtype: "success", request_id: requestId, response } });
  }

  onStdout(chunk) {
    this.buffer += String(chunk);
    let nl;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      try {
        this.onMessage(msg);
      } catch (err) {
        this.emit("error", { message: `handler error: ${err.message}` });
      }
    }
  }

  onMessage(msg) {
    if (msg.type === "control_request") return this.onControlRequest(msg);
    if (msg.type === "control_response") return; // only the initialize ack; nothing to do
    if (msg.type === "system" && msg.subtype === "init") {
      this.status("Connected to the setup assistant.");
      return;
    }
    if (msg.type === "assistant") {
      // Matrix state spans the content blocks of ONE message: everything after
      // the marker, to end of message, is the capability matrix.
      const state = { matrix: null };
      for (const c of msg.message?.content ?? []) {
        if (c.type === "text" && c.text) this.consumeText(c.text, state);
        if (c.type === "tool_use") {
          this.noteToolActivity(c.name, c.input);
          this.noteToolRun(c.id, c.name, c.input);
        }
      }
      if (state.matrix) {
        const md = state.matrix.join("\n").trim();
        if (md) this.emit("matrix", { md });
      }
      return;
    }
    // End of turn: by now every can_use_tool for this turn has arrived, so
    // anything still unverified really did run without asking.
    if (msg.type === "result") { this.flushTripwire(); return; }
    // tool_result frames carry no operator-facing prose the narration has not
    // already said, so they are deliberately not broadcast.
  }

  /**
   * Tripwire. The ask-hook is supposed to make an unrequested shell run
   * impossible — this is how that claim stays checked rather than asserted.
   * Ordering-safe: `can_use_tool` and the `tool_use` block can arrive in
   * either order, so the verdict waits for the end of the turn.
   */
  noteToolRun(id, name, input) {
    if (!SHELL_TOOLS.has(name) || !id) return;
    if (this.askedToolUseIds.has(id)) return;
    this.unverifiedRuns.set(id, String(input?.command ?? ""));
  }

  flushTripwire() {
    for (const command of this.unverifiedRuns.values()) {
      this.notice("unrequested-run", `Ran without asking the installer host first: ${clip(command)}`);
    }
    this.unverifiedRuns.clear();
  }

  /** Strip host markers out of one text block, emit them, narrate the rest. */
  consumeText(text, state) {
    const prose = [];
    const flush = () => {
      const md = prose.join("\n").trim();
      prose.length = 0;
      if (md) this.emit("narration", { md });
    };
    for (const line of String(text).split(/\r?\n/)) {
      if (state.matrix) { state.matrix.push(line); continue; }
      const m = MARKER_RE.exec(line);
      if (!m) { prose.push(line); continue; }
      flush();
      this.onMarker(m[1], parseMarkerAttrs(m[2] || ""), state);
    }
    flush();
  }

  onMarker(kind, attrs, state) {
    if (kind === "phase") return this.setPhase(String(attrs.id || ""));
    if (kind === "plan") return this.setPlan(parsePlanSteps(attrs.steps));
    if (kind === "status") return this.status(attrs.text ?? "");
    if (kind === "probe") {
      const name = String(attrs.name || "").trim();
      if (!name) return;
      const st = PROBE_STATES.has(attrs.status) ? attrs.status : "warn";
      return this.emit("probe", { name, status: st, detail: String(attrs.detail ?? "") });
    }
    if (kind === "app") return this.setAppPort(attrs.port);
    if (kind === "matrix") {
      state.matrix = [];
      this.setPhase("done");
    }
  }

  /** Cheap status even when the agent forgets its markers. */
  noteToolActivity(name, input) {
    if (name === "Bash" || name === "PowerShell") {
      const cmd = String(input?.command ?? "").replace(/\s+/g, " ").trim();
      if (cmd) this.status(`Running: ${cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd}`);
      return;
    }
    if (INSPECT_TOOLS.has(name)) this.status("Inspecting the project…");
  }

  onControlRequest(msg) {
    const req = msg.request ?? {};
    if (req.subtype !== "can_use_tool") {
      this.write({
        type: "control_response",
        response: { subtype: "error", request_id: msg.request_id, error: `unsupported subtype: ${req.subtype}` },
      });
      return;
    }
    const { tool_name: toolName, input, tool_use_id: toolUseID } = req;
    // Seen on the wire — so the tripwire knows this one was not invisible.
    if (toolUseID) {
      this.askedToolUseIds.add(toolUseID);
      this.unverifiedRuns.delete(toolUseID);
    }

    // AskUserQuestion is always intercepted and always allowed — with an answer.
    if (toolName === "AskUserQuestion") {
      this.openQuestions(msg.request_id, input, toolUseID);
      return;
    }

    // Host policy, not an operator decision: the env file's VALUES never enter
    // model context. Denied silently — no card, no status line — because there
    // is nothing here for the operator to weigh up.
    if (targetsEnvFile(toolName, input)) {
      this.respond(msg.request_id, { behavior: "deny", message: ENV_GUARD_MESSAGE, toolUseID });
      return;
    }

    this.noteToolActivity(toolName, input);

    if (AUTO_ALLOW_READONLY.has(toolName)) {
      this.respond(msg.request_id, { behavior: "allow", updatedInput: input, toolUseID });
      return;
    }

    // The wizard invoking its own skill is not a question. On the ledger all
    // the same, because "we started the assistant for you" is a decision.
    if (AUTO_ALLOW_PLUMBING.has(toolName)) {
      this.respond(msg.request_id, { behavior: "allow", updatedInput: input, toolUseID });
      this.notice("auto-allowed", `Ran automatically: ${plumbingLabel(toolName, input)}`);
      return;
    }

    const key = exactKey(toolName, input);
    const isShell = SHELL_TOOLS.has(toolName);
    const command = isShell ? String(input?.command ?? "") : "";

    // 1. The operator already allowed this exact call, this run. Repeating the
    //    question would be fatigue, not protection — but it is still on the
    //    ledger, because a silent repeat is how "allow once" quietly becomes
    //    "allow forever".
    if (this.approvedExact.has(key)) {
      this.respond(msg.request_id, { behavior: "allow", updatedInput: input, toolUseID });
      this.notice("repeat-allowed", `Repeated a step you already allowed: ${clip(command || describeAsk(toolName, input).detail)}`);
      return;
    }

    // 2. Host policy: a read-only diagnostic the operator has nothing to weigh.
    if (isShell) {
      const verdict = classifyCommand(command, this.probePrefixes);
      if (verdict.allowed) {
        // A verdict may hand back an edited command (a network probe that
        // needed a timeout). Allowing with it as `updatedInput` is what the
        // CLI actually runs — measured, not assumed (PROTOCOL.md) — so the
        // ledger line has to name the edit rather than the original.
        const edited = typeof verdict.command === "string" && verdict.command !== command;
        this.respond(msg.request_id, {
          behavior: "allow",
          updatedInput: edited ? { ...input, command: verdict.command } : input,
          toolUseID,
        });
        this.notice(
          "auto-allowed",
          edited
            ? `Ran automatically (timeout added): ${clip(verdict.command)}`
            : `Ran automatically: ${clip(command)}`,
        );
        return;
      }
    }

    this.pendingAsks.set(msg.request_id, { kind: "permission", toolName, input, toolUseID, key });
    const { verb, detail, note } = describeAsk(toolName, input);
    this.emit("permission", {
      id: msg.request_id,
      tool: toolName,
      command: detail,
      description: note || `The assistant wants to ${verb}.`,
      shape: key,
    });
  }

  /** Fan one AskUserQuestion out into one card per question. */
  openQuestions(requestId, input, toolUseID) {
    const questions = Array.isArray(input?.questions) ? input.questions : [];
    const ask = { kind: "question", input, toolUseID, answers: {}, open: new Set() };
    this.pendingAsks.set(requestId, ask);

    if (questions.length === 0) {
      // Nothing to ask — allow it through rather than stranding the agent.
      this.pendingAsks.delete(requestId);
      this.respond(requestId, { behavior: "allow", updatedInput: { ...input, answers: {} }, toolUseID });
      return;
    }

    questions.forEach((q, i) => {
      const id = `${requestId}#${i}`;
      const secret = isSecretQuestion(q);
      const envName = secret ? envNameFrom(q) : null;
      const text = String(q?.question ?? "");
      ask.open.add(id);
      const alreadySet = secret && !!envName && envHasValue(envName);
      this.pendingItems.set(id, { requestId, question: text, secret: secret && !!envName, envName, alreadySet });
      if (secret && envName) {
        this.emit("secret", { id, name: envName, note: text, alreadySet });
      } else {
        this.emit("question", {
          id,
          header: String(q?.header ?? ""),
          question: text,
          multiSelect: !!q?.multiSelect,
          options: (q?.options ?? []).map((o) => ({ label: o.label, description: o.description })),
        });
      }
    });
  }

  /**
   * Record one card's answer; respond to the CLI once every card is in.
   *
   * `outcome` overrides the machine word on the `resolved` event — the secret
   * three-way passes `saved`/`kept`/`skipped`, because the text sent to the
   * agent ("<NAME> is set (written by the installer host …)") is a sentence for
   * a model, not a resolution line for a second face.
   */
  answerItem(id, answerText, { outcome = "answered" } = {}) {
    const item = this.pendingItems.get(id);
    if (!item) return { ok: false, error: "No pending question with that id." };
    const ask = this.pendingAsks.get(item.requestId);
    if (!ask) {
      this.pendingItems.delete(id);
      this.closeCard(id, item.secret ? "secret" : "question", outcome);
      return { ok: false, error: "That question is no longer open." };
    }
    this.pendingItems.delete(id);
    ask.open.delete(id);
    this.closeCard(
      id,
      item.secret ? "secret" : "question",
      outcome,
      item.secret ? undefined : String(answerText ?? ""),
    );
    ask.answers[item.question] = String(answerText ?? "");
    if (ask.open.size === 0) {
      this.pendingAsks.delete(item.requestId);
      this.respond(item.requestId, {
        behavior: "allow",
        updatedInput: { ...ask.input, answers: ask.answers },
        toolUseID: ask.toolUseID,
      });
    }
    return { ok: true, pending: ask.open.size };
  }

  itemFor(id) {
    return this.pendingItems.get(id) ?? null;
  }

  /**
   * `always` is accepted and IGNORED — see PROTOCOL.md. The affordance it fed
   * is gone: repeat fatigue is answered by policy (the safe-command table) and
   * by exact-match memory of decisions the operator has already made, not by
   * inviting them to widen a shape to make the asking stop.
   */
  decide(id, allow, { reason = "" } = {}) {
    const pending = this.pendingAsks.get(id);
    if (!pending || pending.kind !== "permission") return { ok: false, error: "No pending permission with that id." };
    this.pendingAsks.delete(id);
    if (allow) {
      if (pending.key) this.approvedExact.add(pending.key);
      this.respond(id, { behavior: "allow", updatedInput: pending.input, toolUseID: pending.toolUseID });
    } else {
      this.respond(id, {
        behavior: "deny",
        message: reason || "The operator declined this step in the installer wizard. Do not retry it; continue with the rest of the run and record it as skipped.",
        toolUseID: pending.toolUseID,
      });
    }
    this.closeCard(id, "permission", allow ? "allowed" : "declined");
    return { ok: true };
  }

  /** Drop every open card. Nothing may stay half-asked across a stop or exit. */
  failPending(why) {
    for (const [id, ask] of this.pendingAsks) {
      if (ask.kind === "permission") {
        // Best effort: if the pipe is already gone, write() is a no-op.
        this.respond(id, { behavior: "deny", message: why, toolUseID: ask.toolUseID });
      }
    }
    this.pendingAsks.clear();
    this.pendingItems.clear();
    // Every face is told, not just the one that pressed Stop: a card left on
    // screen after the session that owns it is gone is a dead control.
    for (const id of [...this.openCards.keys()]) {
      const kind = this.openCards.get(id)?.type ?? "permission";
      this.closeCard(id, kind, "withdrawn");
    }
  }

  /**
   * Stop the run — for real. `child.kill()` on Windows kills only the launcher:
   * claude.exe spawns PowerShell/node/npm grandchildren that survive it and keep
   * the session alive, which is exactly the bug the Stop button had. `taskkill
   * /T /F` is the only thing that takes the tree down.
   */
  stop() {
    const child = this.child;
    // Synchronous first: a bumped runId makes every buffered stdout chunk,
    // stderr line and exit event from this child a no-op from here on.
    this.runId += 1;
    this.child = null;
    const wasRunning = this.running;
    this.running = false;
    this.failPending("The operator stopped the installer.");
    this.phase = null;
    this.lastStatus = "";
    this.buffer = "";
    this.plan = null;
    this.approvedExact.clear();
    this.askedToolUseIds.clear();
    this.unverifiedRuns.clear();

    if (child) {
      try { child.stdin.end(); } catch { /* already closed */ }
      if (process.platform === "win32" && child.pid) {
        // Ignore the result: a race with a self-exit is a success, not an error.
        try {
          spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        } catch { /* taskkill missing — fall through to kill() */ }
        try { child.kill(); } catch { /* gone */ }
      } else {
        try { child.kill("SIGTERM"); } catch { /* gone */ }
        setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 1500).unref?.();
      }
    }

    this.emit("stopped", {});
    return { ok: true, wasRunning };
  }
}

function isSecretQuestion(q) {
  if (!q) return false;
  if (String(q.header ?? "").trim().toLowerCase() === "secret") return true;
  return /\b[A-Z][A-Z0-9]*(_[A-Z0-9]+)*\b/.test(String(q.question ?? "")) &&
    /\b(key|token|secret|password)\b/i.test(String(q.question ?? ""));
}

/** Pull the env variable name out of a secret question's text. */
function envNameFrom(q) {
  const m = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/.exec(String(q?.question ?? ""));
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ *
 * App proxy — the host relays into the booted app. The port comes from the
 * [[wizard:app]] marker; `Session#appFetch` is the one door.
 *
 * The standalone page cannot reach the app any other way. The studio page is
 * SERVED by that app and could call it directly — but it goes through the same
 * proxy, because the proxy is where the cost control lives (the sample text is
 * chosen here, never accepted from a page) and because one code path means one
 * set of behaviour to reason about.
 * ------------------------------------------------------------------ */

/** Server-chosen, capped sample text. The page never supplies synthesis text. */
export function sampleSentence(language) {
  return String(language || "").toLowerCase().startsWith("cs")
    ? "Dobrý den, takto bude znít KP, když nahlas přečte zprávu pro kandidáta."
    : "Hello — this is how KP will sound when it reads a message out loud.";
}

export const PROVIDER_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
