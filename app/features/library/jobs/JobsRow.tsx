import { ChevronRight } from "lucide-react";
import { formatPercent } from "@/app/_lib/format";
import { formatBand } from "./JobsTypes";
import type { Job } from "./JobsTypes";
import { JobStatusBadge, Td } from "./JobsShared";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

// A clickable corpus row: activating it opens the publish-format posting modal.
export function JobRow({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const enumLabel = useEnumLabel();
  const ep = job.entryProfile;
  return (
    <tr
      tabIndex={0}
      role="button"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="focus-ring cursor-pointer transition-colors hover:bg-paper"
    >
      <td className="w-8 px-2 py-3 text-steel">
        <ChevronRight size={15} aria-hidden />
      </td>
      <Td>
        <span className="flex items-center gap-2">
          <span className="font-medium text-ink">{job.title}</span>
          {/* Lifecycle at a glance: a draft/closed role no longer looks pixel-identical to a live one. */}
          <JobStatusBadge status={job.status} />
        </span>
        <span className="block text-sm text-steel">{job.company ?? "—"}</span>
      </Td>
      <Td>{job.location ?? "—"}</Td>
      <Td className="capitalize">{job.workMode ? enumLabel("workMode", job.workMode) : "—"}</Td>
      <Td className="capitalize">{job.seniority ? enumLabel("seniority", job.seniority) : "—"}</Td>
      <Td>{job.roleFamily ? enumLabel("family", job.roleFamily) : "—"}</Td>
      <Td>{formatBand(job.salaryBand)}</Td>
      <Td>
        {ep?.isEntryEligible ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-sm font-semibold text-green-700">
            {`✓ ${formatPercent(ep.graduateFriendliness ?? 0, { fraction: true })}`}
          </span>
        ) : (
          <span className="text-sm text-steel">—</span>
        )}
      </Td>
    </tr>
  );
}
