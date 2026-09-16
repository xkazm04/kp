"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ExternalLink, Loader2, MessageSquareText, Sparkles, XCircle } from "lucide-react";
import { Badge, FitTierBadge } from "@/app/_components/Badge";
import { ScoreDial } from "@/app/_components/ScoreDial";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CHIP, CHIP_QUIET, EYEBROW, META_LABEL, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { formatGrouped, scoreTone } from "@/app/_lib/format";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { DismissReason, FitArtifact, JobseekerDialog, PostingStatus, SalaryFloor } from "@/app/_lib/jobseeker/types";
import { useFitTierLabels } from "@/app/features/shared/matchLabels";
import { classifyApiFailure, TRANSPORT_FAILURE, type ClassifiedFailure } from "./apiFailure";
import { DismissPicker } from "./DismissPicker";
import { EligibilityChips } from "./EligibilityChips";
import { FailureNotice } from "./FailureNotice";
import { compareSalary } from "./feedModel";
import { FitArtifactSections, FitVerdictRow } from "./FitSheet";
import { FitStudio } from "./FitStudio";
import { diveOutcome, reasoningView, type DiveOutcome, type PostingDetailView } from "./postingView";
import type { StudioDegradation } from "./CvStudio";
import { usePostingActions } from "./usePostingActions";

// The posting page. The advertisement is rendered as PLAIN PARAGRAPHS (split on blank
// lines) and never as HTML: a source's markup is untrusted, and a job ad is prose. The
// salary is compared with the seeker's floor only in one currency (feedModel.ts); the
// match is the store's projection; the reasoning is shown when the posting was
// deep-dived, else a "Deep-dive" door (POST .../deepdive) whose keyless answer says
// `deterministic` and is shown, not stored (deepdive.ts's rule).

const SCORE_BAR: Record<ReturnType<typeof scoreTone>, string> = {
  strong: "bg-score-strong",
  mid: "bg-score-mid",
  weak: "bg-score-weak",
  null: "bg-score-null",
};

type StudioState = { dialog: JobseekerDialog; degradation: StudioDegradation | null } | null;
/** A status move the page asked for, kept so the failure notice can re-issue it. */
type PostingWrite = { status: Exclude<PostingStatus, "gone">; dismiss?: { reason: DismissReason; note: string } };
/** A deep-dive that ANSWERED. `failed` never lands here — it is the error line. */
type DeepDive = { reasoning: PostingDetailView["reasoning"]; outcome: Exclude<DiveOutcome, "failed"> } | null;

export type SettledFit = { artifact: FitArtifact; at: string };

export function PostingDetail({
  view,
  salaryFloor,
  profileId,
  fit,
}: {
  view: PostingDetailView;
  salaryFloor: SalaryFloor | null;
  profileId: string | null;
  /** The latest CLOSED fit dialog's verdict for this posting, read on the server. */
  fit: SettledFit | null;
}) {
  const t = useTranslations("me.posting");
  const tJobs = useTranslations("me.jobs");
  const tPrefs = useTranslations("me.preferences");
  const locale = useLocale();
  const router = useRouter();
  const rel = useRelativeTime();
  const tierLabels = useFitTierLabels();
  const [status, setStatus] = useState(view.status);
  const [dismissing, setDismissing] = useState(false);
  const [studio, setStudio] = useState<StudioState>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<ClassifiedFailure | null>(null);
  const [diving, setDiving] = useState(false);
  const [dive, setDive] = useState<DeepDive>(null);
  const [diveError, setDiveError] = useState<ClassifiedFailure | null>(null);
  // The write the reader last asked for, so the failure notice can re-issue THAT one.
  const [lastWrite, setLastWrite] = useState<PostingWrite | null>(null);
  // The server read is the initial value; a verdict settled in the overlay lands here
  // without a reload (the page behind it is a server component and is not re-fetching).
  const [settledFit, setSettledFit] = useState<SettledFit | null>(fit);

  const actions = usePostingActions((row) => {
    setStatus(row.status);
    router.refresh();
  });

  // Every status move on this page goes through one of these two, so a failed write
  // always leaves behind the request that failed.
  const write = (next: PostingWrite) => {
    setLastWrite(next);
    void actions.setStatus(view.id, next.status, next.dismiss);
  };
  const applyAndOpen = () => {
    setLastWrite({ status: "applied" });
    void actions.markApplied(view);
  };
  // Retry re-issues the PATCH alone: the source tab "Applied" opens is a side effect
  // of the reader's first click, and a second one is not what a failed write asks for.
  const retryWrite = lastWrite ? () => void actions.setStatus(view.id, lastWrite.status, lastWrite.dismiss) : undefined;

  const deepDive = useCallback(async () => {
    if (diving) return;
    setDiving(true);
    setDiveError(null);
    try {
      const res = await fetch(`/api/jobseeker/postings/${encodeURIComponent(view.id)}/deepdive`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { reasoning?: Record<string, unknown> | null; source?: string; fallbackReason?: string | null; code?: string } | null;
      // Keyless is an ANSWER, not a failure: only a refused request or a shape this page
      // cannot read is an error. `no_provider` and `template` both render the honest note.
      const outcome = res.ok ? diveOutcome(body) : "failed";
      if (outcome === "failed") {
        // Classified, not `code ?? null`: a server that never answered in JSON is a
        // transport fault, and "check that the app is running" is a different
        // sentence from "the deep dive could not be run".
        setDiveError(classifyApiFailure(res, body));
        return;
      }
      setDive({ reasoning: reasoningView(body?.reasoning && typeof body.reasoning === "object" ? body.reasoning : null), outcome });
      // A model rationale was persisted with a re-match: re-read the projection. A
      // template was not stored, so there is nothing on the server to go and fetch.
      if (outcome === "llm") router.refresh();
    } catch {
      setDiveError(TRANSPORT_FAILURE);
    } finally {
      setDiving(false);
    }
  }, [diving, view.id, router]);

  // The fit dialog: resume the open one for THIS posting, else create one.
  const openStudio = useCallback(async () => {
    if (!profileId || opening) return;
    setOpening(true);
    setOpenError(null);
    try {
      const list = await fetch(`/api/jobseeker/dialogs?profileId=${encodeURIComponent(profileId)}`);
      const listed = (await list.json().catch(() => null)) as { dialogs?: JobseekerDialog[] } | null;
      const open = (listed?.dialogs ?? []).find((d) => d.kind === "fit" && d.postingId === view.id && d.status === "open");
      if (open) {
        setStudio({ dialog: open, degradation: null });
        return;
      }
      const res = await fetch("/api/jobseeker/dialogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "fit", postingId: view.id, lang: locale }),
      });
      const body = (await res.json().catch(() => null)) as { dialog?: JobseekerDialog; fallbackReason?: string | null; fallbackLang?: string | null; code?: string } | null;
      if (!res.ok || !body?.dialog) {
        setOpenError(classifyApiFailure(res, body));
        return;
      }
      setStudio({ dialog: body.dialog, degradation: body.fallbackReason ? { reason: body.fallbackReason, lang: body.fallbackLang ?? null } : null });
    } catch {
      setOpenError(TRANSPORT_FAILURE);
    } finally {
      setOpening(false);
    }
  }, [profileId, opening, view.id, locale]);

  const live = status !== "dismissed" && status !== "gone";
  const busy = actions.busyId === view.id;
  const salary = compareSalary(view.salary, salaryFloor);
  const salaryRange =
    view.salary.currency && (view.salary.min !== null || view.salary.max !== null)
      ? [view.salary.min, view.salary.max]
          .filter((n): n is number => n !== null)
          .map((n) => formatGrouped(n, locale))
          .join(" – ") +
        ` ${view.salary.currency.toUpperCase()}` +
        (view.salary.period ? ` ${tPrefs(`period.${view.salary.period}`)}` : "")
      : null;
  const reasoning = view.reasoning ?? dive?.reasoning ?? null;
  // The template note stands on its own: an empty template still says WHY the panel is
  // thin, which is the whole point of answering keyless instead of erroring.
  const templateNote = dive?.outcome === "no_provider" ? t("reasoning.deterministic") : dive?.outcome === "template" ? t("reasoning.templateOnly") : null;
  const paragraphs = view.bodyText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="space-y-6">
      <Link href="/me/jobs" className={`${BTN_GHOST} h-8 px-2 text-sm`}>
        <ArrowLeft size={14} aria-hidden /> {t("back")}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{view.title}</h1>
          <p className="mt-2 text-sm text-steel">
            {[view.company, view.location, view.workMode ? tJobs(`workMode.${view.workMode}`) : null].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 text-sm text-steel">
            {t("meta.source", { label: view.sourceLabel })}
            {view.postedAt ? ` · ${t("meta.posted", { when: rel(view.postedAt) })}` : ""}
            {view.lastSeenAt ? ` · ${t("meta.seen", { when: rel(view.lastSeenAt) })}` : ""}
          </p>
          {view.attribution ? <p className="mt-1 text-sm text-steel">{view.attribution}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status === "applied" ? "positive" : status === "shortlisted" ? "info" : status === "new" ? "neutral" : "caution"} label={tJobs(`status.${status}`)} />
          <a href={view.url} target="_blank" rel="noopener noreferrer" className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
            <ExternalLink size={14} aria-hidden /> {t("openSource")}
          </a>
          {profileId ? (
            <button type="button" className={`${BTN_PRIMARY} h-9 px-3 text-sm`} disabled={opening} onClick={() => void openStudio()}>
              {opening ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <MessageSquareText size={14} aria-hidden />} {t("discuss")}
            </button>
          ) : null}
          {live && status !== "applied" ? (
            <button type="button" className={`${BTN_SECONDARY} h-9 px-3 text-sm`} disabled={busy} onClick={applyAndOpen}>
              {tJobs("action.applied")}
            </button>
          ) : null}
          {live ? (
            <button type="button" className={`${BTN_GHOST} h-9 px-3 text-sm`} disabled={busy} aria-expanded={dismissing} onClick={() => setDismissing((v) => !v)}>
              <XCircle size={14} aria-hidden /> {tJobs("action.dismiss")}
            </button>
          ) : status === "dismissed" ? (
            <button type="button" className={`${BTN_SECONDARY} h-9 px-3 text-sm`} disabled={busy} onClick={() => write({ status: "new" })}>
              {tJobs("action.restore")}
            </button>
          ) : null}
        </div>
      </header>
      {dismissing ? (
        <DismissPicker
          title={view.title}
          busy={busy}
          onConfirm={(reason, note) => {
            setDismissing(false);
            write({ status: "dismissed", dismiss: { reason, note } });
          }}
          onCancel={() => setDismissing(false)}
        />
      ) : null}
      {actions.error ? (
        <FailureNotice failure={actions.error} fallback={tJobs("actionError")} onRetry={retryWrite} retrying={busy} onDismiss={actions.clearError} />
      ) : null}
      {openError ? <FailureNotice failure={openError} fallback={t("discussError")} onRetry={() => void openStudio()} retrying={opening} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className={`${PANEL} p-5`} aria-labelledby="posting-text">
          <h2 id="posting-text" className={META_LABEL}>
            {t("text.title")}
          </h2>
          <div className="mt-3 space-y-3 text-body leading-7 text-ink">
            {paragraphs.length > 0 ? paragraphs.map((p, i) => <p key={i}>{p}</p>) : <p className="text-sm text-steel">{t("text.none")}</p>}
          </div>
        </section>

        <div className="space-y-6">
          <section className={`${PANEL} p-5`} aria-labelledby="posting-salary">
            <h2 id="posting-salary" className={META_LABEL}>
              {t("salary.title")}
            </h2>
            <p className="mt-2 text-sm text-ink">{salaryRange ?? t("salary.unstated")}</p>
            {salary.kind === "no_floor" ? (
              <p className="mt-1 text-sm text-steel">{t("salary.noFloor")}</p>
            ) : salary.kind === "not_comparable" ? (
              <p className="mt-1 text-sm text-steel">{t("salary.notComparable", { posting: salary.posting, floor: salary.floor })}</p>
            ) : salary.kind === "compared" ? (
              <p className={`mt-1 text-sm ${salary.verdict === "below_floor" ? "text-amber-700" : "text-moss"}`}>{t(`salary.${salary.verdict}`, { pct: salary.pct })}</p>
            ) : null}
          </section>

          <section className={`${PANEL} p-5`} aria-labelledby="posting-match">
            <h2 id="posting-match" className={META_LABEL}>
              {t("match.title")}
            </h2>
            {view.match ? (
              <div className="mt-3 space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                  <ScoreDial score={view.match.total} />
                  <div className="space-y-2">
                    <FitTierBadge tier={view.match.fitTier} labels={tierLabels} />
                    {view.match.confidence ? (
                      <p className="text-sm text-steel">
                        {tJobs("card.confidence", {
                          level: tJobs(`confidenceLevel.${view.match.confidence.level}`),
                          low: Math.round(view.match.confidence.low),
                          high: Math.round(view.match.confidence.high),
                        })}
                      </p>
                    ) : null}
                    {view.jobSource ? <span className={CHIP_QUIET}>{t(`match.jobSource.${view.jobSource}`)}</span> : null}
                  </div>
                </div>
                {view.match.breakdown.length > 0 ? (
                  <ul className="space-y-1.5">
                    {view.match.breakdown.map((d) => (
                      <li key={d.key} className="text-sm">
                        <div className="flex items-center justify-between gap-2 text-steel">
                          <span>{d.label}</span>
                          <span className="nums text-ink">{Math.round(d.percent)}</span>
                        </div>
                        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-100" aria-hidden>
                          <div className={`h-full rounded-full ${SCORE_BAR[scoreTone(d.percent)]}`} style={{ width: `${Math.max(0, Math.min(100, d.percent))}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <SkillList label={t("match.matched")} skills={view.match.matchedSkills} tone="positive" />
                <SkillList label={t("match.missing")} skills={view.match.missingSkills} tone="caution" />
                <SkillList label={t("match.unproven")} skills={view.match.unprovenSkills} tone="neutral" />
                {view.match.eligibility.length > 0 ? (
                  <div>
                    <p className={META_LABEL}>{tJobs("eligibility.title")}</p>
                    <div className="mt-1.5">
                      <EligibilityChips flags={view.match.eligibility} size="md" />
                    </div>
                    <ul className="mt-2 space-y-1 text-sm text-steel">
                      {view.match.eligibility
                        .filter((f) => f.detail)
                        .map((f) => (
                          <li key={f.key}>
                            <span className="font-medium text-ink">{tJobs(`eligibility.key.${f.key}`)}:</span> {f.detail}
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-steel">{t("match.notScored")}</p>
            )}
          </section>

          {settledFit ? (
            <section className={`${PANEL} p-5`} aria-labelledby="posting-fit">
              <h2 id="posting-fit" className={META_LABEL}>
                {t("fit.title")}
              </h2>
              <p className="mt-1 text-sm text-steel">{t("fit.settled", { when: rel(settledFit.at) })}</p>
              <FitVerdictRow verdict={settledFit.artifact.verdict} applied={status === "applied"} onMarkApplied={applyAndOpen} />
              <div className="mt-4 space-y-6">
                <FitArtifactSections artifact={settledFit.artifact} closed />
              </div>
            </section>
          ) : null}

          <section className={`${PANEL} p-5`} aria-labelledby="posting-reasoning">
            <h2 id="posting-reasoning" className={META_LABEL}>
              {t("reasoning.title")}
            </h2>
            {reasoning || templateNote ? (
              <div className="mt-3 space-y-3 text-sm">
                {templateNote ? <p className="text-sm text-steel">{templateNote}</p> : null}
                {reasoning ? (
                  <>
                    <p className="text-ink">{reasoning.verdict}</p>
                    <ReasonList label={t("reasoning.strengths")} items={reasoning.strengths} />
                    <ReasonList label={t("reasoning.gaps")} items={reasoning.gaps} />
                    <ReasonList label={t("reasoning.probes")} items={reasoning.probes} />
                  </>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-sm text-steel">{t("reasoning.none")}</p>
                {view.match ? (
                  <button type="button" className={`${BTN_SECONDARY} h-9 px-3 text-sm`} disabled={diving} onClick={() => void deepDive()}>
                    {diving ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Sparkles size={14} aria-hidden />} {diving ? t("reasoning.running") : t("reasoning.cta")}
                  </button>
                ) : null}
                {diveError ? <FailureNotice failure={diveError} fallback={t("reasoning.error")} onRetry={() => void deepDive()} retrying={diving} /> : null}
              </div>
            )}
          </section>
        </div>
      </div>

      {studio ? (
        <FitStudio
          dialog={studio.dialog}
          posting={view}
          initialDegradation={studio.degradation}
          onDialogChange={(dialog) => setStudio((s) => (s ? { ...s, dialog } : s))}
          onDone={(artifact) => setSettledFit({ artifact, at: new Date().toISOString() })}
          onMarkApplied={applyAndOpen}
          applied={status === "applied"}
          onClose={() => setStudio(null)}
        />
      ) : null}
    </div>
  );
}

function SkillList({ label, skills, tone }: { label: string; skills: string[]; tone: "positive" | "caution" | "neutral" }) {
  const t = useTranslations("me.posting.match");
  return (
    <div>
      <p className={META_LABEL}>{label}</p>
      {skills.length === 0 ? (
        <p className="mt-1 text-sm text-steel">{t("none")}</p>
      ) : (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <li key={s}>
              {tone === "neutral" ? <span className={CHIP}>{s}</span> : <Badge tone={tone} label={s} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReasonList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={META_LABEL}>{label}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-steel">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
