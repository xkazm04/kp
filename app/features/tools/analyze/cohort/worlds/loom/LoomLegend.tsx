import { LoomKnot } from "./LoomKnot";
import type { LoomWords } from "./useLoomWords";

const TIERS = ["strong", "solid", "thin", "weak"] as const;
const SAMPLE: Record<(typeof TIERS)[number], number> = { strong: 92, solid: 74, thin: 52, weak: 21 };

/**
 * How to read the loom, drawn with the loom's own parts: the four knot tiers, a missing knot, a
 * thread still being spun, a note's tag, the loose float (inside the noise), the bound knot (a lead
 * that clears) and the slack thread (a decoy). The samples are decorative; the words carry it.
 */
export function LoomLegend({ words }: { words: LoomWords }) {
  const { t } = words;
  return (
    <div className="lm-legend">
      <p className="lm-legend__title">{t("legend.label")}</p>
      <ul>
        {TIERS.map((tier) => (
          <li key={tier}>
            <LoomKnot knot={{ kind: "rated", tier, rating: SAMPLE[tier], comment: false }} bind={null} />
            <span>{t(`legend.${tier}`)}</span>
          </li>
        ))}
        <li>
          <LoomKnot knot={{ kind: "absent", reason: "notRead", mark: "unread" }} bind={null} />
          <span>{t("legend.absent")}</span>
        </li>
        <li>
          <LoomKnot knot={{ kind: "absent", reason: "pending", mark: "spinning" }} bind={null} />
          <span>{t("legend.spinning")}</span>
        </li>
        <li>
          <LoomKnot knot={{ kind: "rated", tier: "solid", rating: 70, comment: true }} bind={null} />
          <span>{t("legend.note")}</span>
        </li>
        <li>
          <span className="lm-legend__float" aria-hidden />
          <span>{t("legend.float")}</span>
        </li>
        <li>
          <LoomKnot knot={{ kind: "rated", tier: "strong", rating: 88, comment: false }} bind="stitch" />
          <span>{t("legend.stitch")}</span>
        </li>
        <li>
          <span className="lm-legend__slack" aria-hidden />
          <span>{t("legend.slack")}</span>
        </li>
      </ul>
    </div>
  );
}
