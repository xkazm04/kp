import { memo } from "react";
import { ChevronRight } from "lucide-react";
import { formatBand } from "./JobsTypes";
import type { Job } from "./JobsTypes";
import { RoleStatusCell, Td } from "./JobsShared";
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
        </span>
        <span className="block text-sm text-steel">{job.company ?? "—"}</span>
      </Td>
      <Td>{job.location ?? "—"}</Td>
      <Td className="capitalize">{job.workMode ? enumLabel("workMode", job.workMode) : "—"}</Td>
      <Td className="capitalize">{job.seniority ? enumLabel("seniority", job.seniority) : "—"}</Td>
      <Td>{job.roleFamily ? enumLabel("family", job.roleFamily) : "—"}</Td>
      <Td>{formatBand(job.salaryBand)}</Td>
      {/* Status: the chip and its "hired / target" progress are ONE fact and must
          read as one line, so the cell does not wrap (the same reason the Entry
          column it replaced did not). The lifecycle badge that used to sit beside
          the title is gone with it — saying the same thing twice in one row made
          the title cell noisier without telling the reader anything new. */}
      <Td className="whitespace-nowrap">
        <RoleStatusCell job={job} />
      </Td>
    </tr>
  );
});
