"use client";

import { Fragment } from "react";
import { Inbox } from "lucide-react";
import { LoadStatus } from "@/app/_components/LoadStatus";
import type { LoadState } from "@/app/_lib/useLoader";
import { ApplyTokenPill } from "./ApplyTokenPill";
import { SubmissionForm } from "./SubmissionForm";
import { SubmissionRow } from "./SubmissionRow";
import type { Posting } from "./DevTypes";

export function PostingsSection({ postings, loadPostings, state }: { postings: Posting[]; loadPostings: () => void; state: LoadState }) {
  if (postings.length === 0) return <LoadStatus state={state} label="postings" />;
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <Inbox size={13} className="text-coral" /> Postings &amp; submissions <span className="text-coral">· {postings.length}</span>
        <LoadStatus state={state} label="postings" variant="pill" />
      </h3>
      <p className="mt-1 text-micro text-steel">
        The distribution seam. Publishing posts to a channel (local stub) and returns an apply token; submissions arrive
        on the IN side. Real channels (email / ATS / job board) plug into the same adapter.
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {postings.map((p) => (
          <div key={p.id} className="rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-paper px-2 py-0.5 text-micro font-semibold uppercase text-steel">{p.channel}</span>
              <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{p.caseTitle || p.roleTitle || "Posting"}</span>
              <span className="text-micro text-steel">{p.submissions?.length ?? p.submissionCount ?? 0} in</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="shrink-0 text-micro uppercase tracking-wide text-steel">Apply link</span>
              <ApplyTokenPill token={p.token} />
            </div>

            {(p.submissions ?? []).length > 0 ? (
              <ul className="mt-2 space-y-1.5 border-t border-stone-100 pt-2">
                {[...(p.submissions ?? [])]
                  .sort((a, b) => (b.transferScore ?? -1) - (a.transferScore ?? -1))
                  .map((s, i, arr) => {
                    const rank = s.transferScore != null ? i + 1 : null;
                    const isTop = rank === 1;
                    return (
                      <Fragment key={s.id}>
                        <SubmissionRow submission={s} caseId={p.caseId} rank={rank} isTop={isTop} onChanged={loadPostings} />
                        {/* subtle divider separating the recommended leader from the rest */}
                        {isTop && arr.length > 1 ? (
                          <li aria-hidden className="border-t border-dashed border-stone-200" />
                        ) : null}
                      </Fragment>
                    );
                  })}
              </ul>
            ) : null}

            <SubmissionForm postingId={p.id} onDone={loadPostings} />
          </div>
        ))}
      </div>
    </section>
  );
}
