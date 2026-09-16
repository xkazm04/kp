import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { getRoleOpenConfig, jobVisibleToWorkspace } from "@/app/_lib/db/jobs";
import { listJobTranslations } from "@/app/_lib/db/job-translations";
import { postingSourceLang, runPostingTranslation } from "@/app/_lib/job-translate-run";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { isLocale } from "@/i18n/locales";

// The role's posting in the languages it was opened in.
//
// Opening a role names its languages and the go-live renders them post-commit
// (job-translate-run.ts). This door is the other two halves: reading what exists,
// and generating ONE language on demand — the button behind the posting tab's
// empty state, for a language whose render was refused (no model configured at the
// time), failed, or was added to the role after it went live.
//
// The GET is deliberately a full read including bodies: a role has at most one row
// per app locale, so this is four documents at the very most and a summary-then-
// fetch round trip would buy nothing.

// The translation is a whole-document LLM call, so the same bound the other
// document-sized spawns carry. NOTE this bounds nothing on a self-hosted
// `next start`, which never kills a handler — TRANSLATE_TIMEOUT_MS inside the
// runner is the real bound; this only stops a platform that enforces one from
// 504-ing a legitimate call and orphaning the child.
export const maxDuration = 180;

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const ws = await currentWorkspace();
    // 404 rather than 403, like every other jobs door: the endpoint must not confirm
    // that another tenant's role id exists.
    if (!jobVisibleToWorkspace(id, ws)) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    const config = getRoleOpenConfig(id);
    return NextResponse.json({
      // The languages the ROLE was opened in — the chips the modal draws, including
      // the ones that have no body yet. Without it the tab could only offer what
      // already exists, which is the opposite of what an empty state is for.
      langs: config.postingLangs,
      sourceLang: postingSourceLang(config.postingLangs),
      translations: listJobTranslations(id, ws),
    });
  } catch (error) {
    return safeJsonError(error, "api:jobs/translations", "JOB_TRANSLATIONS_FAILED");
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const ws = await currentWorkspace();
    if (!jobVisibleToWorkspace(id, ws)) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    const body = (await request.json().catch(() => null)) as { lang?: unknown } | null;
    const lang = String(body?.lang ?? "");
    const sourceLang = postingSourceLang(getRoleOpenConfig(id).postingLangs);
    // A refusal, not a fault: an unknown locale and the posting's OWN language are
    // both "there is nothing to translate", and neither should reach a model.
    if (!isLocale(lang) || lang === sourceLang) return jsonRefusal("JOB_TRANSLATION_LANG_INVALID", 400);

    // Per-IP, AFTER the 404 and the input refusal (a rejected call costs no budget)
    // and BEFORE the spawn. 20/10min matches /publish — the generous shape, because
    // this is a deliberate act a recruiter performs a handful of times per role and
    // a burst across a freshly opened req list is legitimate. It exists to stop a
    // loop: every accepted call spawns a child and spends a whole-document LLM call.
    // Session-gated, and in open mode (KP_OPERATOR_PASSWORD unset) that gate is a
    // no-op for the whole API.
    if (!rateLimit(`jobs-translate:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    const outcome = await runPostingTranslation(id, lang, { workspaceId: ws, sourceLang, signal: request.signal });
    if (!outcome.ok) {
      // KEYLESS DEGRADES TO A REFUSAL, never to a stub. The runner already answered
      // without throwing and persisted nothing; the client keeps its empty state and
      // reads the reason in its own language through `errors.*`. `reason` rides along
      // for the operator's benefit (it names the descent — `no_provider`,
      // `llm_error:*`) and is never what the client renders.
      return jsonRefusal("JOB_TRANSLATION_UNAVAILABLE", 503, { reason: outcome.reason });
    }
    return NextResponse.json({ ok: true, translation: outcome.translation });
  } catch (error) {
    return safeJsonError(error, "api:jobs/translations", "JOB_TRANSLATE_FAILED");
  }
}
