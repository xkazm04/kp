"use client";

import { FileUp, Link2, PenLine, ClipboardPaste } from "lucide-react";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import { SENIORITY_OPTIONS, type JobDraft, type JobDraftMode, type OnboardingCtrl } from "./steps";

// Onboarding step: capture the first job description — the activation moment.
// Two modes: WRITE one in-flow (title + seniority + responsibilities) or IMPORT
// an existing posting by pasting it (file/URL import stubbed for the prototype).
export function JobDescriptionStep({ ctrl }: { ctrl: OnboardingCtrl }) {
  const job = ctrl.state.job;
  const setJob = (patch: Partial<JobDraft>) => ctrl.update({ job: { ...job, ...patch } });

  return (
    <div className="max-w-lg space-y-4">
      <SegmentedControl<JobDraftMode>
        label="How to add your first role"
        value={job.mode}
        onChange={(mode) => setJob({ mode })}
        options={[
          { value: "write", label: (<span className="inline-flex items-center gap-1.5"><PenLine size={14} aria-hidden /> Write it</span>) },
          { value: "import", label: (<span className="inline-flex items-center gap-1.5"><ClipboardPaste size={14} aria-hidden /> Import existing</span>) },
        ]}
      />

      {job.mode === "write" ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="setup-job-title" className={`${META_LABEL} block`}>
              Job title
            </label>
            <input
              id="setup-job-title"
              autoFocus
              value={job.title}
              onChange={(e) => setJob({ title: e.target.value })}
              placeholder="e.g. Senior Java Backend Engineer"
              className={`${FIELD} mt-1 w-full`}
            />
          </div>

          <div>
            <span className={`${META_LABEL} block`}>Seniority</span>
            <div className="mt-1">
              <SegmentedControl
                label="Seniority"
                value={job.seniority}
                onChange={(seniority) => setJob({ seniority })}
                options={SENIORITY_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
              />
            </div>
          </div>

          <div>
            <label htmlFor="setup-job-body" className={`${META_LABEL} block`}>
              Responsibilities &amp; must-haves
            </label>
            <textarea
              id="setup-job-body"
              value={job.body}
              onChange={(e) => setJob({ body: e.target.value })}
              rows={4}
              placeholder="Own core backend services · Java, Spring, SQL · mentor the team…"
              className={`${FIELD} mt-1 w-full resize-y`}
            />
            <p className="mt-1 text-sm text-steel">KP expands this into a full, branded job description you can edit.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor="setup-job-paste" className={`${META_LABEL} block`}>
              Paste an existing job description
            </label>
            <textarea
              id="setup-job-paste"
              autoFocus
              value={job.body}
              onChange={(e) => setJob({ body: e.target.value })}
              rows={6}
              placeholder="Paste the full posting here — KP parses the title, seniority, and requirements."
              className={`${FIELD} mt-1 w-full resize-y`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-steel">Or import from</span>
            <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-stone-300 px-3 py-1 text-sm text-steel">
              <FileUp size={14} aria-hidden /> a file
            </span>
            <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-stone-300 px-3 py-1 text-sm text-steel">
              <Link2 size={14} aria-hidden /> a URL
            </span>
            <span className="text-sm text-steel">— coming soon</span>
          </div>
        </div>
      )}
    </div>
  );
}
