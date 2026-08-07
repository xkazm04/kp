// State + data-loading for JobsCampaignTab.tsx — extracted verbatim (no
// behaviour change) so the tab file stays under the 200-line split threshold.
// Owns: the pack fetch/generate lifecycle, the language toggle, the
// copy-to-clipboard state, and the pack-as-Markdown export.
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { isLocale, type Locale } from "@/i18n/locales";
import { BEATS, HOOK_LABEL_KEY, isHookType, WARN_KEY, type PackRecord } from "./jobsCampaignTabTypes";

export function useCampaignTabLogic(jobId: string, appLocale: string) {
  const t = useTranslations("jobs.campaign");
  const [lang, setLang] = useState<Locale>(isLocale(appLocale) ? appLocale : "en");
  const [record, setRecord] = useState<PackRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which copy button just fired ("v3" / "all") — drives the brief ✓ flash.
  const [copied, setCopied] = useState<string | null>(null);

  // The (job, lang) pair whose pack is loaded/in-flight — fetch fires once per
  // pair, and a stale response from a quick lang toggle can't clobber the
  // current one (every state write re-checks the key).
  const requestKeyRef = useRef<string | null>(null);

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
          if (requestKeyRef.current === key) setError(t("loadFailed"));
        })
        .finally(() => {
          if (requestKeyRef.current === key) setLoading(false);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [jobId, lang, t]);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setRecord((d.pack as PackRecord | null) ?? null);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("generateFailed"));
    } finally {
      setGenerating(false);
    }
  };

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

  return { t, lang, setLang, record, loading, generating, error, copied, generate, copyText, pack, variants, warnings, packMarkdown };
}
