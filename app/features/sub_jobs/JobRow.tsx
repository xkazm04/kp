import { formatPercent } from "@/app/_lib/format";
import { DisclosureRow } from "@/app/_components/DisclosureRow";
import { FAMILY_LABEL, formatBand } from "./JobsTypes";
import type { Job } from "./JobsTypes";
import { Td } from "./JobsShared";
import { JobDetail } from "./JobDetail";

export function JobRow({
  job,
  isOpen,
  autoLoad,
  onToggle,
}: {
  job: Job;
  isOpen: boolean;
  autoLoad: boolean;
  onToggle: () => void;
}) {
  const ep = job.entryProfile;
  return (
    <DisclosureRow
      isOpen={isOpen}
      onToggle={onToggle}
      colSpan={8}
      label={`${job.title}${job.company ? ` at ${job.company}` : ""}`}
      detail={<JobDetail job={job} autoLoad={autoLoad} />}
    >
      <Td>
        <span className="font-medium text-ink">{job.title}</span>
        <span className="block text-xs text-steel">{job.company ?? "—"}</span>
      </Td>
      <Td>{job.location ?? "—"}</Td>
      <Td className="capitalize">{job.workMode ?? "—"}</Td>
      <Td className="capitalize">{job.seniority ?? "—"}</Td>
      <Td>{FAMILY_LABEL[job.roleFamily ?? ""] ?? job.roleFamily ?? "—"}</Td>
      <Td>{formatBand(job.salaryBand)}</Td>
      <Td>
        {ep?.isEntryEligible ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
            ✓ {formatPercent(ep.graduateFriendliness ?? 0, { fraction: true })}
          </span>
        ) : (
          <span className="text-xs text-steel">—</span>
        )}
      </Td>
    </DisclosureRow>
  );
}
