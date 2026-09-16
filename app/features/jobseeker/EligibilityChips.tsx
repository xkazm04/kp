"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import type { EligibilityFlag } from "@/app/_lib/jobseeker/types";

// The seeker-side eligibility flags as small chips. HONESTY ON THE CARD, never an
// input to the score: `flag` is a measured mismatch (amber), `ok` a measured match
// (moss), `unknown` means the posting did not say (neutral, never a penalty). The
// engine's detail sentence rides as the title and the accessible name, so the chip
// reads "Salary" and announces "Salary: states 40 000 CZK, your floor is 60 000".

export function EligibilityChips({ flags, size = "sm" }: { flags: EligibilityFlag[]; size?: "sm" | "md" }) {
  const t = useTranslations("me.jobs.eligibility");
  if (flags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label={t("title")}>
      {flags.map((f) => {
        const label = t(`key.${f.key}`);
        const tone = f.state === "flag" ? "caution" : f.state === "ok" ? "positive" : "neutral";
        return (
          <li key={f.key} title={f.detail || undefined}>
            <Badge tone={tone} label={label} ariaLabel={f.detail ? `${label}: ${f.detail}` : `${label}: ${t(`state.${f.state}`)}`} className={size === "md" ? "text-sm" : undefined} />
          </li>
        );
      })}
    </ul>
  );
}
