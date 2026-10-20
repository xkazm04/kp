"use client";

import { Fragment, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatCount } from "./figure";
import { Button } from "./Button";
import "./kit.css";

/**
 * @catalog The reading pane (the split-pane detail layer): a trail, "N of M" with j/k step and Esc/× close, and a document body. It exists only while a row is selected; KitSurface gives it its own column, so the sheet narrows and folds instead of being covered.
 */
export function ReadingPane({
  trail, index, total, onStep, onClose, itemKey, children,
}: {
  trail: string[];
  /** 0-based position of the open item in the list it came from; -1 when it is not in it. */
  index: number;
  total: number;
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
  /** The open item's key: a new item replays the card's short entrance. */
  itemKey: string;
  children: ReactNode;
}) {
  const t = useTranslations("kit.pane");
  const locale = useLocale();
  return (
    <div className="k-margin__card is-entering" key={itemKey} data-part="detail" data-role="kit-pane-card">
      <div className="k-margin__trail">
        {trail.map((part, i) => (
          <Fragment key={`${i}-${part}`}>
            {i > 0 ? "›" : null}
            <span>{part}</span>
          </Fragment>
        ))}
        <span className="k-margin__nav">
          {index >= 0 ? (
            <span className="k-section__count" style={{ alignSelf: "center", marginRight: 6 }}>
              {t("position", { index: formatCount(index + 1, locale), total: formatCount(total, locale) })}
            </span>
          ) : null}
          <Button label={t("prev")} icon="up" iconOnly size="sm" variant="ghost" disabled={index <= 0} onClick={() => onStep(-1)} />
          <Button label={t("next")} icon="down" iconOnly size="sm" variant="ghost" disabled={index < 0 || index >= total - 1} onClick={() => onStep(1)} />
          <Button label={t("close")} icon="x" iconOnly size="sm" variant="ghost" onClick={onClose} />
        </span>
      </div>
      {children}
    </div>
  );
}
