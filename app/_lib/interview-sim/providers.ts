// The Claude CLI as a SimLlm (spark interview-uat-tranche, WP-1): the stand-in for the
// realtime interviewer model, and the simulated candidate — one `claude -p` process per
// call, subscription-billed, so a sweep costs no metered tokens.
//
// Mirrors pipeline/jobfit/claude_cli.py's `generate` lane, which is the house precedent:
//   - the child env drops ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, so the CLI uses the
//     operator's Claude seat instead of silently falling back to metered API billing,
//     and the session-nesting markers (CLAUDECODE, CLAUDE_CODE_*), so a sweep launched
//     from inside an agent session starts fresh top-level children;
//   - the child runs in a NEUTRAL empty temp directory with `--setting-sources project`,
//     so no CLAUDE.md or user hook folds kp's own agent instructions into the role-play;
//   - `--output-format json`, the envelope parsed strictly, an error subtype is an error;
//   - a timeout, after which the child is killed;
//   - REFUSED under KP_OFFLINE (the CLI reaches Anthropic's cloud) — at construction and
//     again at every call.
// Two deliberate differences, both for fidelity of a ROLE-PLAY: the system text is the
// session's system prompt (`--system-prompt-file`, not a `<system>` block inside the
// user prompt), so the stand-in is not also Claude Code's coding agent; and `--tools ""`
// removes every built-in tool, so a turn is text and nothing else. The consumer-terms
// production veto of the Python lane does not apply: this is a dev-only instrument on
// synthetic candidates, never on a real person's data.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isOffline } from "../offline";
import type { SimLlm } from "./types";

/** Keys stripped from the child so it bills the subscription, not the API. */
export const STRIPPED_API_KEY_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;
/** Session-nesting markers stripped unconditionally (claude_cli.py _SESSION_MARKER_ENV). */
export const STRIPPED_SESSION_ENV = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "CLAUDE_CODE_SIMPLE"] as const;
export const DEFAULT_CLI_TIMEOUT_MS = 180_000;
/** A normal envelope is kilobytes; anything near this is a runaway child. */
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;

export class SimProviderError extends Error {}

export const OFFLINE_REFUSAL = "KP_OFFLINE is set: the Claude CLI reaches Anthropic's cloud, so the simulator will not call it. Use --fake for a keyless run.";

/** The child's environment: the parent's, minus the billing keys and session markers. */
export function claudeChildEnv(env: Readonly<Record<string, string | undefined>> = process.env): NodeJS.ProcessEnv {
  const out = { ...env } as NodeJS.ProcessEnv;
  for (const k of [...STRIPPED_API_KEY_ENV, ...STRIPPED_SESSION_ENV]) delete out[k];
  return out;
}

/** The resolved `claude` executable, or null when it is not on PATH. */
export function resolveClaudeCli(command = "claude"): string | null {
  if (path.isAbsolute(command)) return existsSync(command) ? command : null;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [command], { encoding: "utf8" });
  if (probe.status !== 0) return null;
  const first = (probe.stdout || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return first ?? null;
}

/** One conversation rendered for a one-shot `claude -p`: every turn in order, then the
 *  single thing asked of the model — the next assistant turn, verbatim. */
export function renderConversation(messages: { role: "user" | "assistant"; content: string }[]): string {
  const body = messages.map((m) => `<turn role="${m.role}">\n${m.content}\n</turn>`).join("\n");
  return (
    `<conversation>\n${body}\n</conversation>\n\n` +
    "Write the next assistant turn of this conversation: only its text, exactly as it should read, with nothing before or after it."
  );
}

/** Strip a turn wrapper the model echoed around its answer. */
export function unwrapTurn(text: string): string {
  return text
    .trim()
    .replace(/^<turn role="assistant">\s*/i, "")
    .replace(/\s*<\/turn>\s*$/i, "")
    .trim();
}

/** The `result` of a `claude -p --output-format json` envelope, or a thrown error. */
export function parseCliEnvelope(stdout: string, stderr: string, code: number | null): string {
  const out = stdout.trim();
  if (!out) throw new SimProviderError(`Claude CLI produced no output (exit ${code}): ${stderr.slice(0, 300)}`);
  let envelope: unknown;
  try {
    envelope = JSON.parse(out);
  } catch {
    throw new SimProviderError(`Claude CLI output was not JSON: ${out.slice(0, 300)}`);
  }
  if (envelope === null || typeof envelope !== "object") throw new SimProviderError("Claude CLI envelope is not an object");
  const e = envelope as { is_error?: unknown; subtype?: unknown; result?: unknown; error?: unknown };
  if (e.is_error === true || (typeof e.subtype === "string" && e.subtype !== "success")) {
    throw new SimProviderError(`Claude CLI returned an error (subtype=${String(e.subtype)}): ${String(e.result ?? e.error ?? "unknown").slice(0, 300)}`);
  }
  return unwrapTurn(String(e.result ?? ""));
}

let neutralDir: string | null = null;
function neutralCwd(): string {
  if (!neutralDir || !existsSync(neutralDir)) neutralDir = mkdtempSync(path.join(tmpdir(), "kp-sim-claude-"));
  return neutralDir;
}

/** The system text as a file the CLI reads (argv would hit Windows' command-line limit
 *  and its quoting); one file per distinct text, named by its digest. */
function systemFile(system: string): string {
  const file = path.join(neutralCwd(), `system-${createHash("sha256").update(system, "utf8").digest("hex").slice(0, 16)}.txt`);
  if (!existsSync(file)) writeFileSync(file, system, "utf8");
  return file;
}

function quoteForCmd(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`;
}

function runCli(exe: string, args: string[], input: string, timeoutMs: number): Promise<string> {
  // An npm-installed `claude` on Windows is a .cmd shim, which only a shell can launch.
  const viaShell = /\.(cmd|bat)$/i.test(exe);
  return new Promise((resolve, reject) => {
    const child = viaShell
      ? spawn([quoteForCmd(exe), ...args.map(quoteForCmd)].join(" "), { shell: true, cwd: neutralCwd(), env: claudeChildEnv(), windowsHide: true })
      : spawn(exe, args, { cwd: neutralCwd(), env: claudeChildEnv(), windowsHide: true });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill();
      settle(() => reject(new SimProviderError(`Claude CLI timed out after ${Math.round(timeoutMs / 1000)} s`)));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_STDOUT_BYTES) {
        child.kill();
        settle(() => reject(new SimProviderError("Claude CLI stdout exceeded 4 MB (a runaway child)")));
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk.slice(0, 4000);
    });
    child.on("error", (err) => settle(() => reject(new SimProviderError(`Claude CLI failed to start: ${err.message}`))));
    child.on("close", (code) =>
      settle(() => {
        try {
          resolve(parseCliEnvelope(stdout, stderr, code));
        } catch (err) {
          reject(err);
        }
      }),
    );
    child.stdin.on("error", () => {
      /* the child exited before reading its prompt — its exit code carries the reason */
    });
    child.stdin.end(input, "utf8");
  });
}

export type ClaudeCliOptions = {
  /** `--model` (e.g. "sonnet"); the CLI's default when absent. */
  model?: string | null;
  timeoutMs?: number;
  command?: string;
  /** Distinguishes the two sides in the conversation record. */
  role?: "interviewer" | "candidate";
};

/** A SimLlm backed by `claude -p`. Throws SimProviderError under KP_OFFLINE or when the
 *  CLI is not installed. */
export function claudeCliLlm(opts: ClaudeCliOptions = {}): SimLlm {
  if (isOffline()) throw new SimProviderError(OFFLINE_REFUSAL);
  const exe = resolveClaudeCli(opts.command ?? "claude");
  if (!exe) throw new SimProviderError("Claude CLI not found on PATH (install it and run `claude login`), or use --fake for a keyless run.");
  const model = opts.model?.trim() || null;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  return {
    id: `claude-cli${model ? `:${model}` : ""}${opts.role ? `/${opts.role}` : ""}`,
    async complete({ system, messages }) {
      if (isOffline()) throw new SimProviderError(OFFLINE_REFUSAL);
      const args = [
        "-p",
        "--output-format",
        "json",
        "--setting-sources",
        "project",
        "--tools",
        "",
        "--no-session-persistence",
        "--system-prompt-file",
        systemFile(system),
        ...(model ? ["--model", model] : []),
      ];
      return runCli(exe, args, renderConversation(messages), timeoutMs);
    },
  };
}
