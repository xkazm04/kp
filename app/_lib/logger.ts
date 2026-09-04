import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { CodeReviewStatus } from "./code-review-status";
import type { OutboxStatus } from "./comms-status";

/** Where the append-only JSONL telemetry lives: KP_LOG_DIR, else <cwd>/tmp.
 *
 *  ONE declaration. The writer (this file) and the reader (ops-telemetry.ts) each
 *  used to derive the same expression independently, so a rename or a relocation had
 *  to be made twice and missing one produced the quietest possible bug: the ops
 *  surface reporting a healthy "no telemetry yet" while the app wrote its logs
 *  somewhere else entirely.
 *
 *  A function, not a frozen const: the env is read per call, so a test (and a process
 *  that sets KP_LOG_DIR after this module loads) points both halves at the same
 *  directory instead of at whatever cwd happened to be at import time. */
export function logDir(): string {
  return process.env.KP_LOG_DIR ?? path.join(process.cwd(), "tmp");
}

let ensuredDir: string | null = null;

function ensureLogDir(): void {
  const dir = logDir();
  if (ensuredDir === dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    ensuredDir = dir;
  } catch {
    // Disk full / permissions issue; subsequent appendFile errors are
    // already swallowed by appendLine.
  }
}

export function newRequestId(): string {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * A stable, NON-REPLAYABLE handle for a candidate capability token.
 *
 * `/schedule/<token>` is a capability link: the token IS the credential, it stays live
 * after booking (it is the candidate's durable reschedule link — see the confirmation
 * dispatch in app/api/schedule/[token]/route.ts), and the two schedule logs below are
 * explicitly meant to be shipped to an alerting sink. Writing the raw token into a log
 * line therefore hands anyone who can read logs — a hosted log vendor, an on-call
 * console, stdout scraped by the platform, a log excerpt pasted into an issue — the
 * ability to open that candidate's invite and rebook or cancel their interview.
 *
 * A truncated SHA-256 keeps everything the log is FOR (recognising repeat lines about
 * the same invite, joining the console line to the file record) while being useless as
 * a credential. The operator's ACTIONABLE handle is `entry_id`, logged right beside it,
 * plus the invite's own `needs_reconcile` / `needs_more_slots` flag in the store.
 */
function inviteRef(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
}

async function appendLine(filename: string, payload: Record<string, unknown>): Promise<void> {
  ensureLogDir();
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...payload }) + "\n";
    await appendFile(path.join(logDir(), filename), line, "utf-8");
  } catch {
    // Logging must never break the request; swallow.
  }
}

export type AnalyzeLog = {
  request_id: string;
  route: "analyze" | "analyze-stream";
  candidate_label?: string;
  variant_count?: number;
  jd_present: boolean;
  jd_slug: string | null;
  company_present: boolean;
  github_present: boolean;
  cache_hit: boolean;
  duration_ms: number;
  status: "ok" | "error";
  saved_slug?: string | null;
  error?: string;
};

export async function logAnalyze(entry: AnalyzeLog): Promise<void> {
  await appendLine("analyze.log", entry);
}

export type GithubLog = {
  request_id: string;
  github_user: string;
  duration_ms: number;
  status: "ok" | "error";
  rest_repos: number;
  code_review_status?: CodeReviewStatus;
  error?: string;
};

export async function logGithub(entry: GithubLog): Promise<void> {
  await appendLine("github.log", entry);
}

// Outbound-comms delivery log. Today it only records dead-letters (status
// "failed") — the durable half of the escalation a silently-dropped offer or
// rejection never got (see comms.ts `alertDeadLetter`). A real deployment would
// ship comms.log to an alerting sink so candidate-facing drops page someone.
export type CommsLog = {
  kind: string; // message kind: offer | rejection | outreach | acknowledgement | …
  recipient: string; // the resolved identifier the relay received (see candidateRecipient)
  ref: string | null; // pipeline entry id, so the drop is traceable to a candidate
  channel: string;
  status: OutboxStatus;
  attempts: number; // how many delivery attempts ran before dead-lettering
  detail: string; // last HTTP/network failure detail
};

export async function logComms(entry: CommsLog): Promise<void> {
  await appendLine("comms.log", entry);
}

// Schedule invite/pipeline drift. The candidate confirmed a slot (their invite
// reads "booked") but advancing the linked pipeline entry threw, so the recruiter
// board still shows them waiting — a silent divergence that, before this, left no
// log, metric, or flag. We count every occurrence (readable via
// getScheduleReconcileCount()) and record a structured line so operators can find
// and reconcile invite/pipeline drift. A real deployment would ship
// schedule-reconcile.log to an alerting sink.
export type ScheduleReconcileLog = {
  /** The invite's capability token. NEVER written out verbatim — it is fingerprinted
   *  through {@link inviteRef} and recorded as `invite`. */
  token: string;
  entry_id: string;
  slot: string;
  error: string;
};

let scheduleReconcileCount = 0;

/** Total schedule-confirm pipeline-advance failures seen this process. */
export function getScheduleReconcileCount(): number {
  return scheduleReconcileCount;
}

export async function logScheduleReconcile(entry: ScheduleReconcileLog): Promise<void> {
  scheduleReconcileCount += 1;
  const { token, ...rest } = entry;
  const invite = inviteRef(token);
  console.error(
    `[schedule:reconcile] confirmed invite but pipeline advance failed — invite=${invite} entry=${entry.entry_id}: ${entry.error}`
  );
  await appendLine("schedule-reconcile.log", { invite, ...rest });
}

// Zero offerable slots. A candidate opened a scheduling link but every slot in
// the proposal horizon was already booked (idea-5df8e10f) — before this the
// picker showed a "we'll be in touch" dead-end with no recruiter-side signal, so
// the booking could quietly stall. We count every fresh occurrence (readable via
// getScheduleNoSlotsCount()) and record a structured line so the recruiter can
// open more times / widen the horizon for that candidate. The invite is also
// flagged (needs_more_slots) by the store. A real deployment would ship
// schedule-no-slots.log to an alerting sink.
export type ScheduleNoSlotsLog = {
  /** The invite's capability token — fingerprinted, never logged verbatim (see
   *  {@link inviteRef}). */
  token: string;
  entry_id: string | null; // pipeline entry the stalled invite belongs to (for the recruiter)
};

let scheduleNoSlotsCount = 0;

/** Total zero-slots stalls flagged this process (each counted once, on the flag's
 *  0→1 transition — page refreshes don't re-count). */
export function getScheduleNoSlotsCount(): number {
  return scheduleNoSlotsCount;
}

export async function logScheduleNoSlots(entry: ScheduleNoSlotsLog): Promise<void> {
  scheduleNoSlotsCount += 1;
  const { token, ...rest } = entry;
  const invite = inviteRef(token);
  console.error(
    `[schedule:no-slots] candidate hit a fully-booked horizon — invite=${invite} entry=${entry.entry_id ?? "?"}; recruiter must open more times`
  );
  await appendLine("schedule-no-slots.log", { invite, ...rest });
}
