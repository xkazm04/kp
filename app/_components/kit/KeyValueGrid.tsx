"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ABSENT } from "./figure";
import "./kit.css";

export type KeyValue = {
  label: string;
  /** null (or "") is an absence: "—" with `absent` as its tip. */
  value: ReactNode | null;
  absent?: string;
};

/**
 * @catalog Label/value pairs in 2-5 columns on one rhythm; an absent value is "—" with its reason as a tip. Every value null is the exemplar of what will fill.
 */
export function KeyValueGrid({ items, cols }: { items: KeyValue[]; cols?: 2 | 3 | 4 | 5 }) {
  const t = useTranslations("kit");
  const style = cols ? ({ "--kv-cols": cols } as CSSProperties) : undefined;
  return (
    <dl className="k-kv" data-part="kv" style={style}>
      {items.map((it) => {
        const absent = it.value == null || it.value === "";
        return (
          <div key={it.label}>
            <dt>{it.label}</dt>
            <dd
              className={absent ? "is-absent" : undefined}
              data-tip={absent ? it.absent ?? t("absent") : undefined}
              tabIndex={absent ? 0 : undefined}
            >
              {absent ? ABSENT : it.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
