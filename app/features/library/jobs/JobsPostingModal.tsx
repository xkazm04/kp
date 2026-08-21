"use client";

import dynamic from "next/dynamic";
import { BarChart3, Bot, FileText, Gauge, History, Megaphone, Scale } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { Markdown } from "@/app/_components/Markdown";
import { JobLifecycleStrip } from "./JobsLifecycleStrip";
import { RecruiterCandidates } from "./JobsRecruiterCandidates";
import { RediscoverPanel } from "./JobsRediscoverPanel";
import { CompareInterviews } from "./JobsCompareInterviews";
import { POSTING_LOCALES } from "./jobsMarkdown";
import type { Job } from "./JobsTypes";
import { useJobPostingModalLogic } from "./jobsPostingModalLogic";
import { JobsPostingModalFooter } from "./JobsPostingModalFooter";

// Tier 3 (docs/design/loading-choreography.md): these two tabs are click-only (only the
// active tab mounts) and are each >250 lines, so they get their own chunk — the
// modal's default "posting" tab never pays for either bundle. The chunk gap is a
// quiet reserved-height box, never a skeleton.
const CampaignTab = dynamic(() => import("./JobsCampaignTab").then((m) => ({ default: m.CampaignTab })), {
  loading: () => <div className="reveal-quiet min-h-[20rem]" aria-hidden />,
});
const CoachPanel = dynamic(() => import("./JobsCoachPanel").then((m) => ({ default: m.CoachPanel })), {
  loading: () => <div className="reveal-quiet min-h-[16rem]" aria-hidden />,
});
const AgentFitTab = dynamic(() => import("./JobsAgentFitTab").then((m) => ({ default: m.JobsAgentFitTab })), {
  loading: () => <div className="reveal-quiet min-h-[16rem]" aria-hidden />,
});

// Clicking a job opens this: a publish-ready posting (Markdown) with a copy
// action, plus the candidate ranking for the role in a second tab.
export function JobPostingModal({
  job,
  onClose,
  onChanged,
}: {
  job: Job;
  onClose: () => void;
  // Fired after a lifecycle transition (close / publish / reopen) succeeds so the
  // owning Jobs table can refresh the affected row's status badge/chips instead of
  // going stale until a manual reload (job-postings-lifecycle #2).
  onChanged?: (status: "published" | "closed") => void;
}) {
  const logic = useJobPostingModalLogic(job, onChanged);
  const { t, tab, setTab, postingLang, setPostingLang, markdown, statusSuffix, confirmingClose, setConfirmingClose, closeRole } = logic;
  return (
    <Modal
      title={job.title}
      subtitle={[job.company, job.location, statusSuffix].filter(Boolean).join(" · ") || undefined}
      onClose={onClose}
      size="4xl"
      footer={<JobsPostingModalFooter jobId={job.id} logic={logic} />}
    >
      {/* c91ec8b1 — the role's lifecycle at a glance, each segment linking to
          the tab that owns it (JD → channels → board → decisions → offers). */}
      <JobLifecycleStrip jobId={job.id} jobTitle={job.title} />

      <div role="tablist" aria-label={t("viewsAria")} className="mb-3 flex gap-1 border-b border-stone-200">
        {([
          ["posting", "tabPosting", FileText],
          ["coach", "tabCoach", Gauge],
          ["campaign", "tabCampaign", Megaphone],
          ["candidates", "tabCandidates", BarChart3],
          ["rediscover", "tabRediscover", History],
          ["compare", "tabCompare", Scale],
          ["agentfit", "tabAgentFit", Bot],
        ] as const).map(([id, labelKey, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`jobtab-${id}`}
            aria-selected={tab === id}
            aria-controls={`jobpanel-${id}`}
            onClick={() => setTab(id)}
            className={`focus-ring -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${
              tab === id ? "border-coral text-coral" : "border-transparent text-steel hover:text-ink"
            }`}
          >
            <Icon size={14} /> {t(labelKey)}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`jobpanel-${tab}`}
        aria-labelledby={`jobtab-${tab}`}
        tabIndex={0}
        className="focus-ring rounded-lg"
      >
        {tab === "posting" ? (
          <>
            {/* JOB3 — choose the posting's language independently of the app. */}
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-meta uppercase text-steel">{t("postingLanguage")}</span>
              {POSTING_LOCALES.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setPostingLang(loc)}
                  aria-pressed={postingLang === loc}
                  className={`focus-ring rounded-full border px-2.5 py-0.5 text-sm font-semibold uppercase transition-colors ${
                    postingLang === loc ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
                  }`}
                >
                  {loc}
                </button>
              ))}
            </div>
            <article className="rounded-lg border border-stone-200 bg-paper/40 p-4">
              <Markdown content={markdown} />
            </article>
          </>
        ) : tab === "coach" ? (
          <CoachPanel jobId={job.id} jobTitle={job.title} />
        ) : tab === "campaign" ? (
          <CampaignTab jobId={job.id} jobTitle={job.title} />
        ) : tab === "candidates" ? (
          <RecruiterCandidates jobId={job.id} jobTitle={job.title} roleFamily={job.roleFamily ?? null} autoLoad />
        ) : tab === "rediscover" ? (
          <RediscoverPanel jobId={job.id} jobTitle={job.title} />
        ) : tab === "agentfit" ? (
          <AgentFitTab jobId={job.id} />
        ) : (
          <CompareInterviews jobId={job.id} />
        )}
      </div>

      {/* Close confirmation — a themed confirm stacked over the detail modal
          (the Modal stack handles Escape/Tab per-dialog), replacing the native
          window.confirm the design tokens couldn't reach. */}
      {confirmingClose ? (
        <Modal
          title={t("closeRole")}
          onClose={() => setConfirmingClose(false)}
          size="md"
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-steel hover:text-ink"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingClose(false);
                  void closeRole();
                }}
                className="focus-ring inline-flex h-9 items-center rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90"
              >
                {t("closeRole")}
              </button>
            </>
          }
        >
          <p className="text-base text-steel">{t("closeConfirm")}</p>
        </Modal>
      ) : null}
    </Modal>
  );
}
