import { memo } from "react";
import { ChevronRight } from "lucide-react";
import { formatPercent } from "@/app/_lib/format";
import { formatBand } from "./JobsTypes";
import type { Job } from "./JobsTypes";
import { JobStatusBadge, Td } from "./JobsShared";
import type { useEnumLabel } from "@/app/_lib/use-enum-label";

// A clickable corpus row: activating it opens the publish-format posting modal.
//
// MEMO BOUNDARY. The catalog renders up to 500 of these and the tab re-renders on
// every filter keystroke (debounced fetch, `fetching` flag) — every untouched row
// was rebuilt each time. It holds because `onOpen` takes the JOB (a pre-bound
// `() => onOpen(job)` would be a new identity per render) and `enumLabel` is
// hoisted to the ONE list that renders the rows instead of each row opening its
// own `enums` translator subscription. Pinned by jobsCandidatesMemo.test.ts.
export const JobRow = memo(function JobRow({
  job,
  onOpen,
  enumLabel,
}: {
  job: Job;
  onOpen: (job: Job) => void;
  enumLabel: ReturnType<typeof useEnumLabel>;
}) {
  const ep = job.entryProfile;
  return (
    <tr
      tabIndex={0}
      role="button"
      onClick={() => onOpen(job)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(job);
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
});
