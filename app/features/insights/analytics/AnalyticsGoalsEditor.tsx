"use client";

import { useState } from "react";
import { Target } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { TargetInput } from "./AnalyticsTargetInput";
import { TIME_TO_HIRE_KEY } from "./AnalyticsTypes";

// 82c2b8e8 — collapsible goal editor. Per-stage conversion % goals + one
// time-to-hire goal (days), persisted via /api/analytics/targets. The funnel
// colors a stage coral when it misses its goal; the time-to-hire stat shows a
// met/missed pill. Skips the first funnel stage (no inbound conversion ratio).
// Split out of AnalyticsTab.tsx to keep that file under the 200-line cap.
export function GoalsEditor({
  stages,
  conversion,
  timeToHireDays,
  onSaved,
  open: openProp,
  onOpenChange,
}: {
  stages: string[];
  conversion: Record<string, number>;
  timeToHireDays: number | null;
  onSaved: () => void;
  /**
   * UAT TOM-ANA-9 — optionally CONTROLLED. The funnel now refuses to colour a
   * stage the org set no goal for, and says so in a line of copy; that line
   * needs to be able to open this editor in one click, which an internal-only
   * `useState` cannot offer. Omit both props and it stays self-managed, so no
   * existing call site changes.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("analytics.goals");
  const enumLabel = useEnumLabel();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  return (
    <div className="mt-4 border-t border-stone-200 pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="focus-ring flex items-center gap-1.5 rounded text-sm font-semibold text-steel hover:text-ink"
      >
        <Target size={14} /> {t("title")}
      </button>
      {open ? (
        <div className="mt-2 space-y-1.5">
          {/* UAT TOM-ANA-9 — `goals.intro` promised "leave blank to use the
              default 50% threshold". That default is gone: a blank goal now
              means the stage is not judged at all, and the copy has to say so
              or the editor teaches the very fiction the funnel stopped telling. */}
          <p className="text-meta text-steel">{t("introUnset")}</p>
          {stages.slice(1).map((stage) => (
            <TargetInput
              key={stage}
              metric={stage}
              label={enumLabel("stage", stage)}
              value={conversion[stage] ?? null}
              suffix="%"
              onSaved={onSaved}
            />
          ))}
          <TargetInput
            metric={TIME_TO_HIRE_KEY}
            label={t("timeToHire")}
            value={timeToHireDays}
            suffix={t("daysSuffix")}
            onSaved={onSaved}
          />
        </div>
      ) : null}
    </div>
  );
}
