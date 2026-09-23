"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ExternalLink, Loader2, MessageSquareText, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { Badge, FitTierBadge } from "@/app/_components/Badge";
import { IconAction } from "@/app/_components/IconAction";
import { ScoreDial } from "@/app/_components/ScoreDial";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CHIP, CHIP_QUIET, EYEBROW, META_LABEL, PAGE_HEADER, PANEL, SECTION, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { Collapse } from "@/app/features/hiring/pipeline/PipelineMotion";
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

// ONE HEADING VOICE PER LEVEL. Five `<h2>`s on this page were styled as `META_LABEL`
// — the uppercase FIELD-label voice — while their siblings were `font-serif text-h3`,
// so two type registers claimed the same rank and the eye could not tell a section from
// a field. Sections are the serif voice; `META_LABEL` goes back to labelling fields.
const SECTION_H2 = "font-serif text-h3 text-ink";

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
    <div className={`stagger-children ${SECTION}`}>
      <Link href="/me/jobs" className={`${BTN_GHOST} h-8 px-2 text-sm`}>
        <ArrowLeft size={14} aria-hidden /> {t("back")}
      </Link>

      {/* PAGE_HEADER, the recipe six headers in this tree had already hand-rolled: the
          title trio left, the actions right, ruled off from the page. The four-button
          cluster is now graded — ONE primary (the conversation this page exists to
          start), two secondaries, and the destructive/undo move as an `IconAction` that
          carries its own name instead of spending a caption on it. */}
      <header className={PAGE_HEADER}>
        <div className="min-w-0">
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{view.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-steel">
            <Badge tone={status === "applied" ? "positive" : status === "shortlisted" ? "info" : status === "new" ? "neutral" : "caution"} label={tJobs(`status.${status}`)} />
            <span>{[view.company, view.location, view.workMode ? tJobs(`workMode.${view.workMode}`) : null].filter(Boolean).join(" · ")}</span>
          </p>
          <p className="mt-1 text-sm text-steel">
            {t("meta.source", { label: view.sourceLabel })}
            {view.postedAt ? ` · ${t("meta.posted", { when: rel(view.postedAt) })}` : ""}
            {view.lastSeenAt ? ` · ${t("meta.seen", { when: rel(view.lastSeenAt) })}` : ""}
          </p>
          {view.attribution ? <p className="mt-1 text-sm text-steel">{view.attribution}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {profileId ? (
            <button type="button" className={`${BTN_PRIMARY} h-9 px-3 text-sm`} disabled={opening} onClick={() => void openStudio()}>
              {opening ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <MessageSquareText size={14} aria-hidden />} {t("discuss")}
            </button>
          ) : null}
          <a href={view.url} target="_blank" rel="noopener noreferrer" className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
            <ExternalLink size={14} aria-hidden /> {t("openSource")}
          </a>
          {live && status !== "applied" ? (
            <button type="button" className={`${BTN_SECONDARY} h-9 px-3 text-sm`} disabled={busy} onClick={applyAndOpen}>
              {tJobs("action.applied")}
            </button>
          ) : null}
          {live ? (
            <IconAction icon={XCircle} label={tJobs("action.dismiss")} on={dismissing} toggle disabled={busy} side="bottom" size={16} onClick={() => setDismissing((v) => !v)} />
          ) : status === "dismissed" ? (
            <IconAction icon={RotateCcw} label={tJobs("action.restore")} disabled={busy} side="bottom" size={16} onClick={() => write({ status: "new" })} />
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
          <h2 id="posting-text" className={SECTION_H2}>
            {t("text.title")}
          </h2>
          {/* THE MEASURE. This is the longest prose in the product and it was running the
              full panel width — ~110ch at 1440px, roughly a line and a half of what a
              reader can track without losing their place. `max-w-prose` is the same
              measure every other reading surface here holds. */}
          <div className="mt-3 max-w-prose space-y-3 text-body leading-7 text-ink">
            {paragraphs.length > 0 ? paragraphs.map((p, i) => <p key={i}>{p}</p>) : <p className="text-sm text-steel">{t("text.none")}</p>}
          </div>
        </section>

        <div className="space-y-6">
          <section className={`${PANEL} p-5`} aria-labelledby="posting-salary">
            <h2 id="posting-salary" className={SECTION_H2}>
              {t("salary.title")}
            </h2>
            <p className="nums mt-2 text-sm text-ink">{salaryRange ?? t("salary.unstated")}</p>
            {salary.kind === "no_floor" ? (
              <p className="mt-1 text-sm text-steel">{t("salary.noFloor")}</p>
            ) : salary.kind === "not_comparable" ? (
              <p className="mt-1 text-sm text-steel">{t("salary.notComparable", { posting: salary.posting, floor: salary.floor })}</p>
            ) : salary.kind === "compared" ? (
              // A VERDICT IS A BADGE, not a hand-painted sentence. It was a raw
              // `text-amber-700` / `text-moss` fork — a status color spelled by hand,
              // and the one place on this page a caution tone had no shared token
              // behind it. `Badge` owns both tones in both themes.
              <p className="mt-1.5">
                <Badge tone={salary.verdict === "below_floor" ? "caution" : "positive"} label={t(`salary.${salary.verdict}`, { pct: salary.pct })} />
              </p>
            ) : null}
          </section>

          <section className={`${PANEL} p-5`} aria-labelledby="posting-match">
            <h2 id="posting-match" className={SECTION_H2}>
              {t("match.title")}
            </h2>
            {view.match ? (
              <div className="mt-3 space-y-4">
                {/* The dial gets a RESERVED box at its documented size (`ScoreDial` is
                    `w-44 aspect-square`). It used to sit bare in a `flex flex-wrap`, so
                    the tier badge and the confidence band beside it reflowed under the
                    dial while it drew itself in — the one element on the page that moved
                    after the page had settled. */}
                <div className="flex flex-wrap items-center gap-4">
                  <div className="h-44 w-44 shrink-0">
                    <ScoreDial score={view.match.total} />
                  </div>
                  <div className="space-y-2">
                    <FitTierBadge tier={view.match.fitTier} labels={tierLabels} />
                    {view.match.confidence ? (
                      <p className="nums text-sm text-steel">
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
                          {/* The width is an inline style because it is DATA, but it
                              arrives as a jump: a transition makes the bar grow to its
                              figure the way the dial's arc does, and reduced motion
                              turns it off rather than shortening it. */}
                          <div
                            className={`h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none ${SCORE_BAR[scoreTone(d.percent)]}`}
                            style={{ width: `${Math.max(0, Math.min(100, d.percent))}%` }}
                          />
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
            ) : view.blocked ? (
              // FILTERED, not unscored: the gate that removed it, what it would score with
              // that gate lifted (never drawn as the dial — it is not this posting's score),
              // and the door to the profile and preferences that set the gate.
              <div className="mt-3 space-y-3">
                <ul className="flex flex-wrap gap-1.5">
                  {view.blocked.koKeys.map((k) => (
                    <li key={k}>
                      <Badge tone="caution" label={tJobs(`card.filtered.${k}`)} />
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-steel">{t("match.blocked")}</p>
                {view.blocked.asIfTotal !== null ? (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                    <span className="nums">{t("match.blockedAsIf", { score: Math.round(view.blocked.asIfTotal) })}</span>
                    {view.blocked.asIfTier ? <FitTierBadge tier={view.blocked.asIfTier} labels={tierLabels} /> : null}
                  </p>
                ) : null}
                {view.blocked.eligibility.length > 0 ? (
                  <ul className="space-y-1 text-sm text-steel">
                    {view.blocked.eligibility
                      .filter((f) => f.detail)
                      .map((f) => (
                        <li key={f.key}>
                          <span className="font-medium text-ink">{tJobs(`eligibility.key.${f.key}`)}:</span> {f.detail}
                        </li>
                      ))}
                  </ul>
                ) : null}
                <Link href="/me" className="focus-ring inline-block rounded text-sm font-medium text-ink underline">
                  {t("match.blockedLink")}
                </Link>
              </div>
            ) : (
              <p className="mt-2 text-sm text-steel">{t("match.notScored")}</p>
            )}
          </section>

          {/* A verdict settled in the overlay lands here with the overlay still closing
              over it, so the section used to simply BE there on the next frame. Collapse
              grows it from zero height, pushing what is below rather than replacing it;
              a verdict that came from the SERVER read mounts with the page and does not
              animate (AnimatePresence `initial={false}`), which is right — nothing
              arrived, it was always there. The `role="status"` line is spoken only when
              the verdict settled in THIS session, for the same reason. */}
          <Collapse show={settledFit !== null}>
            {settledFit ? (
              <section className={`${PANEL} p-5`} aria-labelledby="posting-fit">
                <h2 id="posting-fit" className={SECTION_H2}>
                  {t("fit.title")}
                </h2>
                <p className="mt-1 text-sm text-steel" role={settledFit !== fit ? "status" : undefined}>
                  {t("fit.settled", { when: rel(settledFit.at) })}
                </p>
                <FitVerdictRow verdict={settledFit.artifact.verdict} applied={status === "applied"} onMarkApplied={applyAndOpen} />
                <div className="mt-4 space-y-6">
                  <FitArtifactSections artifact={settledFit.artifact} closed />
                </div>
              </section>
            ) : null}
          </Collapse>

          <section className={`${PANEL} p-5`} aria-labelledby="posting-reasoning">
            <h2 id="posting-reasoning" className={SECTION_H2}>
              {t("reasoning.title")}
            </h2>
            {/* The deep-dive's answer arrives 20-plus seconds after the click, into a
                panel that was showing a button. Collapse grows it in — and the Collapse
                is mounted UNCONDITIONALLY, toggled by `show`, because a Collapse that
                only mounts when its content exists carries `initial={false}` into its
                first frame and would never animate the one arrival it is here for. When
                the rationale came from THIS session's dive it also says so out loud: a
                reader who cannot see the panel open gets no other signal that the wait
                ended. */}
            <Collapse show={Boolean(reasoning || templateNote)}>
              <div className="mt-3 space-y-3 text-sm">
                {dive ? (
                  <p className="sr-only" role="status">
                    {t("reasoning.arrived")}
                  </p>
                ) : null}
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
            </Collapse>
            {!reasoning && !templateNote ? (
              <div className="mt-2 space-y-2">
                <p className="text-sm text-steel">{t("reasoning.none")}</p>
                {view.match ? (
                  <button type="button" className={`${BTN_SECONDARY} h-9 px-3 text-sm`} disabled={diving} onClick={() => void deepDive()}>
                    {diving ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Sparkles size={14} aria-hidden />} {diving ? t("reasoning.running") : t("reasoning.cta")}
                  </button>
                ) : null}
                {diveError ? <FailureNotice failure={diveError} fallback={t("reasoning.error")} onRetry={() => void deepDive()} retrying={diving} /> : null}
              </div>
            ) : null}
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
