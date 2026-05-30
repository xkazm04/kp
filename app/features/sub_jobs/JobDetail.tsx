import { formatPercent, formatYears } from "@/app/_lib/format";
import type { Job } from "./JobsTypes";
import { Meta, ReqChip } from "./JobsShared";
import { RecruiterCandidates } from "./RecruiterCandidates";

export function JobDetail({ job, autoLoad = false }: { job: Job; autoLoad?: boolean }) {
  const reqs = job.requirements ?? [];
  const musts = reqs.filter((r) => r.kind === "must_have");
  const nices = reqs.filter((r) => r.kind !== "must_have");
  const ep = job.entryProfile;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
      <div>
        {job.description ? <p className="text-base text-ink">{job.description}</p> : null}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-steel">
          <Meta k="Employment" v={job.employmentType ?? "—"} />
          <Meta k="Min. experience" v={job.minYearsExperience != null ? formatYears(job.minYearsExperience) : "—"} />
          <Meta k="Min. education" v={job.minEducation ?? "—"} />
          <Meta k="Languages" v={(job.languages ?? []).join(", ") || "—"} />
        </dl>
        <div className="mt-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-steel">Must-have</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {musts.map((r, i) => (
              <ReqChip key={`m${i}`} req={r} />
            ))}
            {musts.length === 0 ? <span className="text-sm text-steel">—</span> : null}
          </div>
          {nices.length > 0 ? (
            <>
              <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-steel">Nice-to-have</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {nices.map((r, i) => (
                  <ReqChip key={`n${i}`} req={r} />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="rounded-md border border-stone-200 bg-white p-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-coral">Graduate lens</p>
        <p className="mt-1 text-base text-ink">
          {ep?.isEntryEligible ? "Open to early-career candidates" : "Experienced role"}
          {ep ? ` · friendliness ${formatPercent(ep.graduateFriendliness ?? 0, { fraction: true })}` : ""}
        </p>
        {ep?.rationale ? <p className="mt-1 text-sm text-steel">{ep.rationale}</p> : null}
        {ep?.reinterpretedMusts?.length ? (
          <div className="mt-2">
            <p className="text-sm font-semibold uppercase tracking-wide text-steel">
              Requirements, reframed for a graduate
            </p>
            <ul className="mt-1 list-disc pl-4 text-sm text-ink">
              {ep.reinterpretedMusts.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {ep?.trainableGaps?.length ? (
          <p className="mt-2 text-sm text-steel">
            <span className="font-semibold">Trainable on the job:</span> {ep.trainableGaps.join(", ")}
          </p>
        ) : null}
      </div>
      </div>
      <RecruiterCandidates
        jobId={job.id}
        jobTitle={job.title}
        roleFamily={job.roleFamily ?? null}
        autoLoad={autoLoad}
      />
    </div>
  );
}
