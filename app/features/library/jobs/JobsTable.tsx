import { useTranslations } from "next-intl";
import { Th } from "./JobsShared";

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
