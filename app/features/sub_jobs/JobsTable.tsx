import { Th, SkelBar } from "./JobsShared";

// Scrollable table shell with an sr-only caption and a pinned header, so column
// meaning is never lost while scrolling the long corpus. Children is the
// <tbody> (real rows or the loading skeleton).
export function JobsTableFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-stone-200">
      <table className="min-w-full divide-y divide-stone-200">
        <caption className="sr-only">
          Job corpus — normalized job postings filterable by role family, seniority, work mode, and
          entry-eligibility. Activate a row to expand its requirements and graduate lens.
        </caption>
        <thead className="sticky top-0 z-10 bg-paper">
          <tr>
            <th scope="col" className="w-8 px-2 py-3">
              <span className="sr-only">Expand row</span>
            </th>
            <Th>Role</Th>
            <Th>Location</Th>
            <Th>Mode</Th>
            <Th>Seniority</Th>
            <Th>Family</Th>
            <Th>Salary (CZK/mo)</Th>
            <Th>Entry</Th>
          </tr>
        </thead>
        {children}
      </table>
    </div>
  );
}

// Layout-matched loading skeleton: 9 rows of pulsing bars sized to the real
// columns, so the first load doesn't jump when the corpus arrives.
export function JobsTableSkeleton() {
  return (
    <tbody className="divide-y divide-stone-200">
      {Array.from({ length: 9 }).map((_, i) => (
        <tr key={i}>
          <td className="w-8 px-2 py-3">
            <SkelBar className="h-3.5 w-3.5 rounded" />
          </td>
          <td className="px-4 py-3">
            <SkelBar className="h-3.5 w-40" />
            <SkelBar className="mt-1.5 h-2.5 w-24" />
          </td>
          <td className="px-4 py-3">
            <SkelBar className="h-3.5 w-20" />
          </td>
          <td className="px-4 py-3">
            <SkelBar className="h-3.5 w-16" />
          </td>
          <td className="px-4 py-3">
            <SkelBar className="h-3.5 w-16" />
          </td>
          <td className="px-4 py-3">
            <SkelBar className="h-3.5 w-24" />
          </td>
          <td className="px-4 py-3">
            <SkelBar className="h-3.5 w-16" />
          </td>
          <td className="px-4 py-3">
            <SkelBar className="h-5 w-12 rounded-full" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}
