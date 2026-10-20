"use client";

import { useTranslations } from "next-intl";
import { APPROVAL_KINDS, isApprovalKind } from "@/app/_lib/approval-kinds";
import type { OrbitModel } from "../orbitModel";
import { cx } from "../orbitCx";
import type { OrbitWords } from "../orbitWords";
import { waitBreakdown, type LitVia } from "./overviewModel";

type Props = {
  model: OrbitModel;
  words: OrbitWords;
  /** Point at the number (or focus it): light every waiting person. */
  onHot: (on: boolean, via: LitVia) => void;
  onOpen: () => void;
};

/**
 * The one number first: everyone waiting on a human, as the page's hero, and what the number is
 * made of in words, by approval kind ("17 screening reviews, 6 interview slots, 5 key decisions and 1
 * scorecard"; overviewModel.ts says which population each Overview number counts). Pointing at it lights
 * every one of them on the orbit; a click opens the orbit with them lit.
 */
export function OverviewHead({ model, words, onHot, onOpen }: Props) {
  const tl = useTranslations("overviewLit");
  const { t, n, locale } = words;
  const wait = model.total.wait;
  const parts = waitBreakdown(model.people, APPROVAL_KINDS)
    .map((p) => (isApprovalKind(p.kind) ? tl(`kind.${p.kind}`, { count: p.count }) : null))
    .filter((x): x is string => x != null);
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(parts);
  const numCls = cx("ov-num", wait > 0 && "is-needs");
  return (
    <header className="ov-head">
      <button
        type="button"
        className={numCls}
        onPointerEnter={() => onHot(true, "pointer")}
        onPointerLeave={() => onHot(false, "pointer")}
        onFocus={() => onHot(true, "focus")}
        onBlur={() => onHot(false, "focus")}
        onClick={onOpen}
        aria-label={tl("headAria", { count: wait })}
        data-role="overview-waiting"
      >
        {n(wait)}
      </button>
      <div className="ov-say">
        <h2>{t("figWaitingHuman")}</h2>
        <p>{wait > 0 && parts.length ? tl("why", { list }) : tl("whyNone")}</p>
      </div>
    </header>
  );
}
