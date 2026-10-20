"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Download, MicVocal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { downloadFile } from "@/app/_lib/export-utils";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import {
  buildInterviewKitStrings,
  interviewKitMarkdown,
  orderInterviewKitInputs,
} from "@/app/_lib/devcase-interview-kit";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { FollowupQuestionItem } from "./DevShared";
import { pickKitSubmission } from "./DevInterviewKit.select";
import type { Submission } from "./DevTypes";

// 8d4f38b9 — auto-generated interview kit. Held/suspect first so the ownership
// interview is not only for the transfer leader; the picker exports one
// follow-up-bearing shortlist row at a time.
export function InterviewKit({ caseTitle, candidates }: { caseTitle: string; candidates: Submission[] }) {
  const t = useTranslations("devcase.interviewKit");
  const [copied, setCopied] = useState(false);
  const ordered = orderInterviewKitInputs(
    candidates.map((s) => ({
      submission: s,
      authenticityBand: s.evaluation?.authenticity?.band ?? null,
      transferScore: s.transferScore ?? null,
    })),
  ).map((row) => row.submission);
  const [kitSubmissionId, setKitSubmissionId] = useState(ordered[0]?.id ?? "");
  const selected = pickKitSubmission(ordered, kitSubmissionId);
  const questions = selected?.evaluation?.followups?.questions ?? [];
  if (!selected || questions.length === 0) return null;

  const candidateRef = selected.candidateRef ?? "—";
  const band = selected.evaluation?.authenticity?.band;
  const markdown = interviewKitMarkdown(
    {
      caseTitle,
      candidateRef,
      transferScore: selected.transferScore ?? null,
      questions,
      authenticityBand: band ?? null,
    },
    buildInterviewKitStrings((key, values) => t(key as Parameters<typeof t>[0], values)),
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the Download button is the fallback */
    }
  };

  return (
    <section className="rounded-lg border border-moss/30 bg-moss/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-moss">
          <MicVocal size={13} /> {t("title")}
        </h3>
        {ordered.length > 1 ? (
          <Select
            sizeVariant="sm"
            ariaLabel={t("pickAria")}
            value={selected.id}
            onChange={setKitSubmissionId}
            options={ordered.map((s) => {
              const sBand = s.evaluation?.authenticity?.band;
              const auth = sBand ? ` · ${t(`band.${sBand}` as Parameters<typeof t>[0])}` : "";
              const fit = s.transferScore != null ? ` ${t("fit", { score: s.transferScore })}` : "";
              return { value: s.id, label: `${s.candidateRef ?? "—"}${fit}${auth}` };
            })}
          />
        ) : (
          <span className="min-w-0 truncate text-micro text-steel">
            {candidateRef}
            {selected.transferScore != null ? ` ${t("fit", { score: selected.transferScore })}` : ""}
          </span>
        )}
        {band ? (
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-micro font-semibold uppercase ${
              band === "suspect" ? "bg-coral/15 text-coral-ink" : band === "mixed" ? "bg-amber-100 text-amber-700" : "bg-moss/15 text-moss"
            }`}
          >
            {t(`band.${band}` as Parameters<typeof t>[0])}
          </span>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={copy}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-ink hover:border-coral/40"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? t("copied") : t("copy")}
          </button>
          <button
            type="button"
            onClick={() => downloadFile("interview-kit.md", markdown, "text/markdown")}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-ink hover:border-coral/40"
          >
            <Download size={12} /> {t("export")}
          </button>
        </div>
      </div>
      <p className="mt-1.5 text-micro text-steel">{t("intro")}</p>
      <ol className="mt-2 space-y-2">
        {questions
          .filter((q) => (q.question ?? "").trim())
          .map((q, i) => (
            <li key={q.id ?? i} className="rounded-md border border-stone-200 bg-white p-2.5 text-micro">
              <FollowupQuestionItem q={q} index={i} />
            </li>
          ))}
      </ol>
      <DebriefFindings key={selected.id} submissionId={selected.id} count={questions.filter((q) => (q.question ?? "").trim()).length} />
    </section>
  );
}

type FindingKind = "supported" | "revised" | "not_evidenced" | "not_asked";
const KINDS: FindingKind[] = ["supported", "revised", "not_evidenced", "not_asked"];
type DraftFinding = { kind: FindingKind; quote: string };
type DebriefState = {
  findings: { followupIndex: number; kind: FindingKind; quote?: string }[];
  recorded: boolean;
  held: boolean;
  clearedBy: string | null;
  supported: number;
  total: number;
};

// C4 — one finding per follow-up, and the human act that releases an authorship hold.
// An uncovered follow-up is "not asked" (the server reads absence the same way); an
// adverse finding cannot be saved without the words heard.
function DebriefFindings({ submissionId, count }: { submissionId: string; count: number }) {
  const t = useTranslations("devcase.interviewKit.debrief");
  const errMsg = useErrorMessage();
  const [state, setState] = useState<DebriefState | null>(null);
  const [draft, setDraft] = useState<DraftFinding[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    (next: DebriefState) => {
      setState(next);
      setDraft(Array.from({ length: count }, (_, i) => {
        const f = next.findings.find((x) => x.followupIndex === i + 1);
        return { kind: f?.kind ?? "not_asked", quote: f?.quote ?? "" };
      }));
    },
    [count],
  );

  useEffect(() => {
    let live = true;
    fetch(`/api/interview-prep/scorecard?debrief=${encodeURIComponent(submissionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: DebriefState | null) => {
        if (live && j) apply(j);
      })
      .catch(() => {
        /* best-effort: without the state the section simply stays hidden */
      });
    return () => {
      live = false;
    };
  }, [submissionId, apply]);

  if (!state) return null;
  const adverse = (d: DraftFinding) => d.kind === "revised" || d.kind === "not_evidenced";
  const needsQuote = draft.some((d) => adverse(d) && !d.quote.trim());

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/interview-prep/scorecard?debrief=${encodeURIComponent(submissionId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) setError(errMsg(json, t("failed")));
      else apply(json as DebriefState);
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    send({
      findings: draft.map((d, i) => ({ followupIndex: i + 1, kind: d.kind, ...(d.quote.trim() ? { quote: d.quote.trim() } : {}) })),
    });

  return (
    <div className="mt-3 rounded-md border border-stone-200 bg-white p-2.5 text-micro">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-semibold text-ink">{t("title")}</h4>
        <span className="text-steel">{t("progress", { supported: state.supported, total: state.total })}</span>
      </div>
      <p className="mt-1 text-steel">{t("intro")}</p>
      {state.clearedBy ? (
        <p className="mt-1.5 font-semibold text-moss">{t("cleared", { who: state.clearedBy.replace(/^human:/, "") })}</p>
      ) : state.held ? (
        <p className="mt-1.5 font-semibold text-coral-ink">{t("held")}</p>
      ) : null}
      <ol className="mt-2 space-y-1.5">
        {draft.map((d, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1.5">
            <span className="w-5 text-steel">{i + 1}.</span>
            <Select
              sizeVariant="sm"
              ariaLabel={t("pickAria", { n: i + 1 })}
              value={d.kind}
              onChange={(v) => setDraft((cur) => cur.map((x, j) => (j === i ? { ...x, kind: v as FindingKind } : x)))}
              options={KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
            />
            {adverse(d) ? (
              <input
                value={d.quote}
                onChange={(e) => setDraft((cur) => cur.map((x, j) => (j === i ? { ...x, quote: e.target.value } : x)))}
                aria-label={t("quoteLabel")}
                placeholder={t("quotePlaceholder")}
                maxLength={1000}
                className="focus-ring h-8 min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-2 text-micro text-ink"
              />
            ) : null}
          </li>
        ))}
      </ol>
      {needsQuote ? <p className="mt-1.5 text-steel">{t("quoteNeeded")}</p> : null}
      {error ? <p role="alert" className="mt-1.5 text-coral-ink">{error}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={save}
          disabled={busy || needsQuote}
          className={`${BTN_SECONDARY} h-8 bg-white px-2.5 text-micro font-semibold`}
        >
          {busy ? t("saving") : t("save")}
        </button>
        {state.held && state.recorded ? (
          <button
            type="button"
            onClick={() => send({ clear: true })}
            disabled={busy}
            className={`${BTN_SECONDARY} h-8 bg-moss/10 px-2.5 text-micro font-semibold text-moss`}
          >
            {t("clear")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
