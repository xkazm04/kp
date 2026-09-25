"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "./Button";
import "./kit.css";

/**
 * The pager directly under a DataTable's last row (kit.js paint): the visible range, the live
 * count of rows that exist in the DOM (the windowing made visible), caller extras, and a
 * viewport-sized step up and down. Internal to DataTable.
 */
export function DataTablePager({ from, to, total, domRows, extra, onPage }: {
  from: number;
  to: number;
  total: number;
  domRows: number;
  extra?: ReactNode;
  onPage: (dir: 1 | -1) => void;
}) {
  const t = useTranslations("kit.table");
  return (
    <div className="k-pager" data-role="kit-pager">
      <span>
        {t.rich("range", { from, to, total, b: (chunks) => <b>{chunks}</b> })}
      </span>
      <span className="k-pager__dom" data-tip={t("domTip")} tabIndex={0}>
        {t("dom", { count: domRows })}
      </span>
      {extra}
      <span className="k-pager__acts">
        <Button label={t("prev")} icon="up" iconOnly size="sm" variant="ghost" disabled={from <= 1} onClick={() => onPage(-1)} />
        <Button label={t("next")} icon="down" iconOnly size="sm" variant="ghost" disabled={to >= total} onClick={() => onPage(1)} />
      </span>
    </div>
  );
}
