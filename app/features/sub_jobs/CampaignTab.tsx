"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { isLocale, LOCALES, type Locale } from "@/i18n/locales";

// E1 (Erika gap) — the Campaign tab of the job posting modal: feed-ready ad-copy
// variants + 15-second video scripts per candidate language, every CTA pointing
// at the role's quick-apply lead form. Generation is honest about provenance
// (AI vs rule-based fallback) and about the facts it had to do without
// (warning CODES from the wire, localized here).

type VideoScript = { hook: string; offer: string; proof: string; cta: string };
type Variant = { hookType: string; hook: string; adCopy: string; videoScript: VideoScript };
type Pack = { variants?: Variant[]; warnings?: string[]; applyUrl?: string; language?: string };
type PackRecord = { jobId: string; lang: string; payload: Pack; source: string; createdAt: string };

// Canonical wire codes → catalog keys. Kept as an explicit map (not string
// interpolation into t()) so next-intl's typed keys stay checkable.
const HOOK_LABEL_KEY = {
  number: "hookNumber",
  location: "hookLocation",
  problem: "hookProblem",
  skills: "hookSkills",
} as const;
const WARN_KEY = {
  no_salary: "warnNoSalary",
  no_location: "warnNoLocation",
  no_skills: "warnNoSkills",
} as const;

const BEATS = [
  ["hook", "beatHook"],
  ["offer", "beatOffer"],
  ["proof", "beatProof"],
  ["cta", "beatCta"],
] as const;

function isHookType(v: string): v is keyof typeof HOOK_LABEL_KEY {
  return v in HOOK_LABEL_KEY;
}

export function CampaignTab({ jobId }: { jobId: string }) {
  const t = useTranslations("jobs.campaign");
  const appLocale = useLocale();
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

  return (
    <div>
      <p className="text-sm text-steel">{t("intro")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-meta uppercase text-steel">{t("language")}</span>
        {LOCALES.map((loc) => (
          <button
            key={loc}
            type="button"
            onClick={() => setLang(loc)}
            aria-pressed={lang === loc}
            className={`focus-ring rounded-full border px-2.5 py-0.5 text-sm font-semibold uppercase transition-colors ${
              lang === loc ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
            }`}
          >
            {loc}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {variants.length ? (
            <button
              type="button"
              onClick={() => copyText("all", packMarkdown())}
              className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
            >
              {copied === "all" ? <Check size={14} /> : <Copy size={14} />} {copied === "all" ? t("copied") : t("copyAll")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={generate}
            disabled={generating || loading}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {generating ? t("generating") : variants.length ? t("regenerate") : t("generate")}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-red-50 p-2.5 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-steel">
          <Loader2 size={14} className="animate-spin" /> …
        </p>
      ) : !variants.length ? (
        <p className="mt-4 rounded-lg border border-dashed border-stone-300 bg-paper/40 p-4 text-sm text-steel">
          {t("empty")}
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-steel">
            {t("generatedAt", { when: new Date(record!.createdAt).toLocaleString() })} ·{" "}
            <span className={record!.source === "llm" ? "text-moss" : "text-amber-600"}>
              {record!.source === "llm" ? t("sourceLlm") : t("sourceDeterministic")}
            </span>
          </p>

          {warnings.length ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={14} /> {t("warnTitle")}
              </p>
              <ul className="mt-1 list-inside list-disc">
                {warnings.map((w) => (
                  <li key={w}>{t(WARN_KEY[w])}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 space-y-3">
            {variants.map((v, i) => (
              <div key={i} className="rounded-lg border border-stone-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-micro font-semibold uppercase text-steel">
                      {isHookType(v.hookType) ? t(HOOK_LABEL_KEY[v.hookType]) : v.hookType}
                    </span>
                    <p className="mt-1.5 font-serif text-h3 text-ink">{v.hook}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText(`v${i}`, v.adCopy)}
                    className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1 text-sm font-semibold text-ink hover:border-coral/40"
                  >
                    {copied === `v${i}` ? <Check size={13} /> : <Copy size={13} />}{" "}
                    {copied === `v${i}` ? t("copied") : t("copy")}
                  </button>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-base text-ink">{v.adCopy}</p>
                <div className="mt-3 rounded-md bg-paper/60 p-2.5">
                  <p className="text-meta uppercase text-steel">{t("scriptTitle")}</p>
                  <dl className="mt-1.5 space-y-1">
                    {BEATS.map(([beat, key]) => (
                      <div key={beat} className="grid grid-cols-[7.5rem_1fr] gap-2 text-sm">
                        <dt className="font-semibold text-steel">{t(key)}</dt>
                        <dd className="text-ink">{v.videoScript?.[beat] ?? ""}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            ))}
          </div>

          {pack?.applyUrl ? (
            <p className="mt-3 text-sm text-steel">
              {t("applyUrlNote")} <span className="font-mono text-coral">{pack.applyUrl}</span>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
