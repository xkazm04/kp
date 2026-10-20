import { writeFile } from "node:fs/promises";
import path from "node:path";
import { namespaceTranslator } from "./catalog-translator";
import { getJob } from "./db/jobs";
import { saveJobTranslation, type JobTranslation } from "./db/job-translations";
import { buildLlmConfigEnv } from "./llm-config";
import { isOffline } from "./offline";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { buildJobMarkdownStrings, jobToMarkdown } from "@/app/features/library/jobs/jobsMarkdown";
import type { Job } from "@/app/features/library/jobs/JobsTypes";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";

// Rendering a role's posting into the languages the role was OPENED in.
//
// Opening a role names its languages (POST /api/jobs/[id]/publish, `langs`); this
// is what turns each of those names into a document. It runs AFTER the go-live has
// committed — never inside it, because a translation is an LLM round trip and an
// `await` between BEGIN and COMMIT silently destroys a better-sqlite3 transaction's
// atomicity — and the languages are rendered IN PARALLEL, because they are
// independent of each other and a recruiter opening a role in three languages
// should wait for the slowest one, not for their sum.
//
// KEYLESS IS A DECISION, NOT A FAULT, and here it is a REFUSAL rather than a
// fallback. Every other LLM surface in this app has a deterministic twin; a
// translation cannot have one, because the only machine that can turn Czech prose
// into German prose is the model. So with no provider configured the CLI exits 0
// with `source: "deterministic"` and a reason, NOTHING is persisted, and the
// posting tab keeps the empty state whose button offers to try again. A stub
// posting that claimed to be a German advertisement would be far worse than none:
// it is the document a candidate applies against.

/** How long one translation may take. A posting is a full career-page ad and the
 *  answer is that ad again, so this sits with the other whole-document spawns
 *  rather than with the per-turn ones. */
export const TRANSLATE_TIMEOUT_MS = 150_000;

export type TranslationOutcome =
  /** A model translated it and the body is stored. */
  | { ok: true; translation: JobTranslation }
  /** Nothing was translated and nothing was stored — `reason` says why, in the
   *  vocabulary the CLI emits (`no_provider`, `llm_error:*`, `offline`, …). */
  | { ok: false; reason: string };

/** The locale a role's posting is written in. The stored posting has no language
 *  column of its own — the studio renders it from structured fields plus the
 *  catalog — so the source language is the first language the role was opened in,
 *  falling back to the app default. Stated once here so the route, the hook and the
 *  modal cannot each pick a different one. */
export function postingSourceLang(postingLangs: readonly string[] | undefined | null): Locale {
  const first = (postingLangs ?? []).find((l) => isLocale(l));
  return isLocale(first) ? first : DEFAULT_LOCALE;
}

/** The posting exactly as the modal renders it, in `lang`. Shared by the source
 *  document handed to the model and by anything else that needs the artifact
 *  server-side — one renderer, so a translation can never be a translation of a
 *  document the recruiter never saw. */
export async function renderPostingMarkdown(job: Job, lang: Locale): Promise<string> {
  const t = await namespaceTranslator(lang);
  return jobToMarkdown(job, buildJobMarkdownStrings(lang, t));
}

/**
 * Translate ONE language and store it. Never throws for a reason the recruiter can
 * act on: a missing provider, an offline box and a failed call all come back as
 * `{ ok: false, reason }`.
 */
export async function runPostingTranslation(
  jobId: string,
  targetLang: Locale,
  options: { workspaceId?: string; sourceLang?: Locale; signal?: AbortSignal } = {}
): Promise<TranslationOutcome> {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const record = getJob(jobId, workspaceId);
  if (!record) return { ok: false, reason: "job_gone" };
  // The store's JobRecord and the UI's Job are the same payload read through two
  // declarations (the record types its requirement `kind` as a bare string). The
  // renderer is tolerant of exactly that — splitRequirements treats any
  // off-taxonomy kind as a nice-to-have — so this is a re-declaration, not a claim.
  const job = record as unknown as Job;
  const sourceLang = options.sourceLang ?? postingSourceLang(record.postingLangs);
  if (targetLang === sourceLang) return { ok: false, reason: "same_language" };
  // Answer before resolving a key or opening a socket: on a deliberately offline
  // box the honest answer is the refusal, not a provider error.
  if (isOffline()) return { ok: false, reason: "offline" };

  const body = await renderPostingMarkdown(job, sourceLang);
  if (!body.trim()) return { ok: false, reason: "empty_posting" };

  let workdir: string | null = null;
  try {
    workdir = await createWorkdir();
    const bodyPath = path.join(workdir, "posting.md");
    // The document rides in a FILE, never on argv: a posting is long, and argv is
    // world-readable in a process listing.
    await writeFile(bodyPath, body, "utf-8");
    const { result } = spawnPython(
      [
        "-m",
        "pipeline.jobfit.posting_translate_cli",
        "--body-file",
        bodyPath,
        // `--flag=value` form: a title starting with "--" must not be reparsed as a flag.
        `--title=${job.title}`,
        `--source-lang=${sourceLang}`,
        `--target-lang=${targetLang}`,
      ],
      { signal: options.signal, timeoutMs: TRANSLATE_TIMEOUT_MS, env: buildLlmConfigEnv() }
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      console.error(`[job-translate] ${jobId} -> ${targetLang}:`, err.code, err.message);
      return { ok: false, reason: `cli_error:${err.code}` };
    }
    const payload = parsePythonJson<{ result?: { body?: unknown } | null; source?: string; fallbackReason?: string }>(
      stdout,
      stderr
    );
    const translated = typeof payload.result?.body === "string" ? payload.result.body.trim() : "";
    // The refusal path: `source: "deterministic"` means no model answered, and for
    // THIS use case that means no document exists. Persist nothing.
    if (payload.source !== "llm" || !translated) {
      return { ok: false, reason: payload.fallbackReason || "no_provider" };
    }
    return {
      ok: true,
      translation: saveJobTranslation(
        { jobId, lang: targetLang, sourceLang, title: job.title, bodyMd: translated },
        workspaceId
      ),
    };
  } catch (error) {
    // A spawn that never started, an abort, a timeout: the caller is either a
    // post-commit hook (the role is live regardless) or a route that answers the
    // refusal, so neither wants an exception.
    console.error(`[job-translate] ${jobId} -> ${targetLang} failed:`, error instanceof Error ? error.message : error);
    return { ok: false, reason: "spawn_failed" };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}

/**
 * Every language the role was opened in, IN PARALLEL, skipping the source language
 * (which is the posting itself, not a translation of it).
 *
 * `Promise.all` and not a loop: the languages share nothing, and three sequential
 * whole-document calls would take three times as long for no benefit. Each arm
 * already resolves to an outcome rather than throwing, so one refused language
 * never cancels the others.
 */
export async function runPostingTranslations(
  jobId: string,
  langs: readonly string[],
  options: { workspaceId?: string; sourceLang?: Locale; signal?: AbortSignal } = {}
): Promise<Record<string, TranslationOutcome>> {
  const sourceLang = options.sourceLang ?? postingSourceLang(langs);
  const targets = [...new Set(langs.filter(isLocale))].filter((l) => l !== sourceLang);
  const outcomes = await Promise.all(
    targets.map(async (lang) => [lang, await runPostingTranslation(jobId, lang, { ...options, sourceLang })] as const)
  );
  return Object.fromEntries(outcomes);
}
