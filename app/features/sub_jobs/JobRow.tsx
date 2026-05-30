import { ChevronRight } from "lucide-react";
import { formatPercent } from "@/app/_lib/format";
import { FAMILY_LABEL, formatBand } from "./JobsTypes";
import type { Job } from "./JobsTypes";
import { Td } from "./JobsShared";

// A clickable corpus row: activating it opens the publish-format posting modal.
export function JobRow({ job, onOpen }: { job: Job; onOpen: () => void }) {
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
        <span className="font-medium text-ink">{job.title}</span>
        <span className="block text-sm text-steel">{job.company ?? "—"}</span>
      </Td>
      <Td>{job.location ?? "—"}</Td>
      <Td className="capitalize">{job.workMode ?? "—"}</Td>
      <Td className="capitalize">{job.seniority ?? "—"}</Td>
      <Td>{FAMILY_LABEL[job.roleFamily ?? ""] ?? job.roleFamily ?? "—"}</Td>
      <Td>{formatBand(job.salaryBand)}</Td>
      <Td>
        {ep?.isEntryEligible ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-sm font-semibold text-green-700">
            ✓ {formatPercent(ep.graduateFriendliness ?? 0, { fraction: true })}
          </span>
        ) : (
          <span className="text-sm text-steel">—</span>
        )}
      </Td>
    </tr>
  );
}
