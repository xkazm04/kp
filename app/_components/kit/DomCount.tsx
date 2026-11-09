"use client";

import { useTranslations } from "next-intl";
import "./kit.css";

/** The "N rows in the DOM" footer: the DataTable pager's default, also used by grids that are
 *  not a DataTable (the Docket's role table) so the count reads the same on every screen. */
export function DomCount({ count }: { count: number }) {
  const t = useTranslations("kit.table");
  return (
    <span className="k-pager__dom" data-tip={t("domTip")} tabIndex={0}>
      {t("dom", { count })}
    </span>
  );
}
