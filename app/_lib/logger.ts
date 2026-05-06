import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

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
  code_review_status?: "disabled" | "ok" | "error";
  error?: string;
};

export async function logGithub(entry: GithubLog): Promise<void> {
  await appendLine("github.log", entry);
}
