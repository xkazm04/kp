// State + data-loading for JobsCampaignTab.tsx — extracted verbatim (no
// behaviour change) so the tab file stays under the 200-line split threshold.
// Owns: the pack fetch/generate lifecycle, the language toggle, the
// copy-to-clipboard state, and the pack-as-Markdown export.
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { useTaskResult } from "@/app/features/shell/tasks/useTaskResult";
import { isLocale, type Locale } from "@/i18n/locales";
import { BEATS, HOOK_LABEL_KEY, isHookType, WARN_KEY, type PackRecord } from "./jobsCampaignTabTypes";

export function useCampaignTabLogic(jobId: string, appLocale: string, jobTitle?: string) {
  const t = useTranslations("jobs.campaign");
  const { startTask } = useTasks();
  const [lang, setLang] = useState<Locale>(isLocale(appLocale) ? appLocale : "en");
  const [record, setRecord] = useState<PackRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which copy button just fired ("v3" / "all") — drives the brief ✓ flash.
  const [copied, setCopied] = useState<string | null>(null);
  // Generation runs as the background task kind "campaign" (wait-or-leave: the
  // pack persists server-side, so navigating away loses nothing and the unread
  // badge flags the finish). `watch` tracks the run; on success the stored pack
  // is re-fetched below.
  const [taskId, setTaskId] = useState<string | null>(null);
  const watch = useTaskResult(taskId);

  // The (job, lang) pair whose pack is loaded/in-flight — fetch fires once per
  // pair, and a stale response from a quick lang toggle can't clobber the
  // current one (every state write re-checks the key). `reloadNonce` forces a
  // re-fetch of the SAME pair after a finished generation task saves a new pack.
  const requestKeyRef = useRef<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Load the stored pack whenever the language toggles; a failure surfaces as
  // the load error, an absent pack as the empty state. Deferred kick-off (0 ms
  // timer), mirroring RecruiterCandidates: no synchronous setState in the
  // effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    const key = `${jobId}|${lang}`;
    const timer = window.setTimeout(() => {
      if (requestKeyRef.current === key) return;
      requestKeyRef.current = key;
      setLoading(true);
      setError(null);
      fetch(`/api/jobs/${encodeURIComponent(jobId)}/campaign?lang=${lang}`)
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          if (requestKeyRef.current === key) setRecord((d.pack as PackRecord | null) ?? null);
        })
        .catch(() => {
          if (requestKeyRef.current !== key) return;
          setError(t("loadFailed"));
          // A failed load must not leave the PREVIOUS language's pack on screen under
          // the newly-selected one: the tab renders the error banner AND the stored
          // pack side by side, and nothing in the pack names its language — so a
          // recruiter who toggled cs -> de into a 500 saw the Czech ad copy sitting
          // under a lit "DE" toggle and could "Copy all" it onto a German job board.
          // Only a pack that belongs to the key we just failed to load survives (a
          // same-(job, lang) reload after a generation), so a refresh still never
          // blanks content that is already correct — loading-choreography law 2.
          setRecord((prev) => (prev && `${prev.jobId}|${prev.lang}` === key ? prev : null));
        })
        .finally(() => {
          if (requestKeyRef.current === key) setLoading(false);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [jobId, lang, t, reloadNonce]);

  const generating = watch.active || watch.loading;

  const generate = async () => {
    if (generating) return;
    setError(null);
    const task = await startTask("campaign", {
      jobId,
      lang,
      jobTitle: jobTitle ?? jobId,
      // The quick-apply CTA must be absolute; the background handler has no
      // request to read an origin from, so it travels with the params.
      origin: window.location.origin,
    });
    if (task) setTaskId(task.id);
  };

  // React to the flight's outcome: on success the handler has SAVED the pack, so
  // re-fetch the stored record (cheap GET — the task result carries the pack too,
  // but the GET keeps one canonical read path); on failure surface the error.
  useEffect(() => {
    if (!taskId) return;
    const done = watch.status === "succeeded" && watch.full;
    const dead = watch.status === "failed" || watch.status === "interrupted" || watch.status === "canceled";
    if (!done && !dead) return;
    // Deferred (0 ms timer) kick-off — no synchronous setState in the effect
    // body (react-hooks/set-state-in-effect), same pattern as the load effect.
    const timer = window.setTimeout(() => {
      setTaskId(null);
      if (done) {
        requestKeyRef.current = null; // invalidate the (job, lang) fetch key → reload below
        setReloadNonce((n) => n + 1);
      } else {
        // The task runner's own stored diagnostic, passed through unchanged (no
        // machine code to resolve) — ternary, not ||, per use-error-message.ts.
        setError(watch.error ? watch.error : t("generateFailed"));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [taskId, watch.status, watch.full, watch.error, t]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const pack = record?.payload;
  const variants = pack?.variants ?? [];
  const warnings = (pack?.warnings ?? []).filter((w): w is keyof typeof WARN_KEY => w in WARN_KEY);

  // The whole pack as paste-ready Markdown (the export the backlog promised).
  const packMarkdown = () =>
    [
      ...variants.map((v, i) => {
        const label = isHookType(v.hookType) ? t(HOOK_LABEL_KEY[v.hookType]) : v.hookType;
        return [
          `## ${i + 1} · ${label}`,
          "",
          v.adCopy,
          // Per-variant &v= link so a recruiter pasting the Markdown keeps
          // attribution even if they never copy the ad body itself. Absent on
          // pre-E5 packs → the line is simply skipped (filtered below).
          ...(v.applyUrl ? ["", `${t("trackedLink")}: ${v.applyUrl}`] : []),
          "",
          `### ${t("scriptTitle")}`,
          ...BEATS.map(([beat, key]) => `- **${t(key)}**: ${v.videoScript?.[beat] ?? ""}`),
          "",
        ].join("\n");
      }),
      pack?.applyUrl ? `${t("applyUrlNote")} ${pack.applyUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");

  return { t, lang, setLang, record, loading, generating, error, copied, generate, copyText, pack, variants, warnings, packMarkdown, watch };
}
