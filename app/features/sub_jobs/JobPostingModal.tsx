"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Check, Copy, FileText, History, Link2, Scale } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { Markdown } from "@/app/_components/Markdown";
import { buildUrl } from "@/app/features/tabs";
import { RecruiterCandidates } from "./RecruiterCandidates";
import { RediscoverPanel } from "./RediscoverPanel";
import { CompareInterviews } from "./CompareInterviews";
import { jobToMarkdown } from "./jobMarkdown";
import type { Job } from "./JobsTypes";

// Clicking a job opens this: a publish-ready posting (Markdown) with a copy
// action, plus the candidate ranking for the role in a second tab.
export function JobPostingModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<"posting" | "candidates" | "rediscover" | "compare">("posting");
  const [copied, setCopied] = useState(false);
  const [applyCopied, setApplyCopied] = useState(false);
  const markdown = useMemo(() => jobToMarkdown(job), [job]);

  const copyApplyLink = async () => {
    try {
      const url = (typeof window !== "undefined" ? window.location.origin : "") + `/apply/${job.id}`;
      await navigator.clipboard.writeText(url);
      setApplyCopied(true);
      window.setTimeout(() => setApplyCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <Modal
      title={job.title}
      subtitle={[job.company, job.location].filter(Boolean).join(" · ") || undefined}
      onClose={onClose}
      size="4xl"
      footer={
        <>
          <button
            type="button"
            onClick={copyApplyLink}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
          >
            {applyCopied ? <Check size={14} /> : <Link2 size={14} />} {applyCopied ? "Copied" : "Apply link"}
          </button>
          <button
            type="button"
            onClick={() => router.push(buildUrl({ tab: "matrix", job: job.id }))}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
          >
            <BarChart3 size={14} /> Rank in matrix
          </button>
          <button
            type="button"
            onClick={copy}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy markdown"}
          </button>
        </>
      }
    >
      <div role="tablist" aria-label="Job views" className="mb-3 flex gap-1 border-b border-stone-200">
        {([
          ["posting", "Posting", FileText],
          ["candidates", "Candidates", BarChart3],
          ["rediscover", "Rediscover", History],
          ["compare", "Compare", Scale],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`focus-ring -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${
              tab === id ? "border-coral text-coral" : "border-transparent text-steel hover:text-ink"
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === "posting" ? (
        <article className="rounded-lg border border-stone-200 bg-paper/40 p-4">
          <Markdown content={markdown} />
        </article>
      ) : tab === "candidates" ? (
        <RecruiterCandidates jobId={job.id} jobTitle={job.title} roleFamily={job.roleFamily ?? null} autoLoad />
      ) : tab === "rediscover" ? (
        <RediscoverPanel jobId={job.id} jobTitle={job.title} />
      ) : (
        <CompareInterviews jobId={job.id} />
      )}
    </Modal>
  );
}
