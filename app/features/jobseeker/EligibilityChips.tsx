"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { Tooltip } from "@/app/_components/Tooltip";
import type { EligibilityFlag } from "@/app/_lib/jobseeker/types";

// The seeker-side eligibility flags as small chips. HONESTY ON THE CARD, never an
// input to the score: `flag` is a measured mismatch (amber), `ok` a measured match
// (moss), `unknown` means the posting did not say (neutral, never a penalty).
//
// The engine's detail sentence is the EVIDENCE behind the chip, and it is revealed on
// hover AND on focus (surface-doctrine §4) through the shared `Tooltip`. It used to
// ride as `title=`, which surface-doctrine §1 bans for exactly the reasons the tooltip
// component was written down: a `title` is invisible to touch, never appears on
// keyboard focus, and its delay belongs to the browser. The accessible name still
// carries the same sentence, so the chip reads "Salary" and announces "Salary: states
// 40 000 CZK, your floor is 60 000".

export function EligibilityChips({ flags, size = "sm" }: { flags: EligibilityFlag[]; size?: "sm" | "md" }) {
  const t = useTranslations("me.jobs.eligibility");
  if (flags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label={t("title")}>
      {flags.map((f) => {
        const label = t(`key.${f.key}`);
        const tone = f.state === "flag" ? "caution" : f.state === "ok" ? "positive" : "neutral";
        const detail = f.detail || null;
        const badge = (
          <Badge
            tone={tone}
            label={label}
            ariaLabel={detail ? `${label}: ${detail}` : `${label}: ${t(`state.${f.state}`)}`}
            className={size === "md" ? "text-sm" : undefined}
          />
        );
        return (
          <li key={f.key}>
            {detail ? (
              // `tabIndex` is what makes the evidence reachable without a mouse: the
              // badge is a span, so the tooltip's focus half would otherwise never fire.
              <Tooltip label={detail} side="bottom">
                <span tabIndex={0} className="focus-ring rounded-full">
                  {badge}
                </span>
              </Tooltip>
            ) : (
              badge
            )}
          </li>
        );
      })}
    </ul>
  );
}
