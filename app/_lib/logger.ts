import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { CodeReviewStatus } from "./code-review-status";
import type { OutboxStatus } from "./comms-status";

const LOG_DIR = process.env.KP_LOG_DIR ?? path.join(process.cwd(), "tmp");

let logDirReady = false;

function ensureLogDir(): void {
  if (logDirReady) return;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    logDirReady = true;
  } catch {
    // Disk full / permissions issue; subsequent appendFile errors are
    // already swallowed by appendLine.
  }
}

export function newRequestId(): string {
  return crypto.randomBytes(8).toString("hex");
}

async function appendLine(filename: string, payload: Record<string, unknown>): Promise<void> {
  ensureLogDir();
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...payload }) + "\n";
    await appendFile(path.join(LOG_DIR, filename), line, "utf-8");
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
  console.error(
    `[schedule:reconcile] confirmed invite but pipeline advance failed — token=${entry.token} entry=${entry.entry_id}: ${entry.error}`
  );
  await appendLine("schedule-reconcile.log", entry);
}
