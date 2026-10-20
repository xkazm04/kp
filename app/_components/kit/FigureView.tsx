"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Figure } from "./types";
import { figureClass, figureDelta, figureDraw, figureValue } from "./figure";
import "./kit.css";

/**
 * @catalog One figure, set the one way the kit sets a number: label, serif numeral, quiet "of N", unit, signed delta, an optional drawn bar; null prints "—" with its reason as a tip, never 0.
 */
export function FigureView({ figure, rolling = false }: { figure: Figure; rolling?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("kit");
  const delta = figureDelta(figure.delta, locale);
  const draw = figureDraw(figure.draw);
  const tip = figure.tip ?? (figure.value == null ? t("absent") : undefined);
  return (
    <div className={figureClass(figure, rolling)} data-tip={tip} tabIndex={tip ? 0 : undefined} data-role="kit-fig">
      <span className="k-fig__label">{figure.label}</span>
      <span className="k-fig__value">
        {figureValue(figure.value, locale)}
        {figure.of != null ? <span className="k-fig__of"> {t("of", { total: figure.of })}</span> : null}
        {figure.unit ? <span className="k-fig__unit">{figure.unit}</span> : null}
        {delta ? <span className={`k-fig__delta is-${delta.dir}`}>{delta.text}</span> : null}
      </span>
      {draw ? (
        <div className="k-fig__bar" aria-hidden>
          <i style={{ width: draw }} />
        </div>
      ) : null}
    </div>
  );
}
