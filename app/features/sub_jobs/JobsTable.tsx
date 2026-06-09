import { useTranslations } from "next-intl";
import { Th, SkelBar } from "./JobsShared";

// Scrollable table shell with an sr-only caption and a pinned header, so column
// meaning is never lost while scrolling the long corpus. Children is the
// <tbody> (real rows or the loading skeleton).
export function JobsTableFrame({ children }: { children: React.ReactNode }) {
  const t = useTranslations("jobs.table");
  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-stone-200">
      <table className="min-w-full divide-y divide-stone-200">
        <caption className="sr-only">{t("caption")}</caption>
        <thead className="sticky top-0 z-10 bg-paper">
          <tr>
            <th scope="col" className="w-8 px-2 py-3">
              <span className="sr-only">{t("expandRow")}</span>
            </th>
            <Th>{t("colRole")}</Th>
            <Th>{t("colLocation")}</Th>
            <Th>{t("colMode")}</Th>
            <Th>{t("colSeniority")}</Th>
            <Th>{t("colFamily")}</Th>
            <Th>{t("colSalary")}</Th>
            <Th>{t("colEntry")}</Th>
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
