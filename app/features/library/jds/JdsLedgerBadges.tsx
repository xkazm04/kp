"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { labelize } from "@/app/_lib/format";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { Badge } from "@/app/_components/Badge";
import { jdStatusChip, seniorityMeta, type JdRow } from "./jdsLibrary";

// The "Analyzing" status chip with a spinning glyph — matches Badge's `info` tone
// (bg-blue-50/text-blue-700) but animates, which the shared Badge (fixed icon
// class) can't. Used wherever a JD is mid-build. Extracted verbatim from
// LibrarySavedJdsLedger.tsx so that file stays under the 200-line split threshold.
export function AnalyzingChip() {
  const t = useTranslations("library.tab");
  return (
    <span
      aria-label={t("analyzingAria")}
      className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-sm font-semibold text-blue-700"
    >
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      <span>{t("analyzingLabel")}</span>
    </span>
  );
}

// The JD status chip, localized. jdStatusChip supplies the tone + icon (display-
// neutral); the label + ariaLabel resolve HERE through the `library.tab.chip*`
// keys, so the chip reads in the recruiter's locale instead of hardcoded English.
// The "linked" case shows the linked job's own lifecycle string (labelize'd) —
// a free value, not an enum with a catalog entry.
export function StatusBadge({ row, muted }: { row: JdRow; muted?: boolean }) {
  const t = useTranslations("library.tab");
  const chip = jdStatusChip(row);
  let label: string;
  let ariaLabel: string;
  switch (chip.category) {
    case "analyzing":
      label = t("analyzingLabel");
      ariaLabel = t("analyzingAria");
      break;
    case "failed":
      label = t("chipFailed");
      ariaLabel = t("chipFailedAria");
      break;
    case "live":
      label = t("chipLive");
      ariaLabel = t("chipLiveAria");
      break;
    case "draft":
      label = t("chipDraft");
      ariaLabel = t("chipDraftAria");
      break;
    case "closed":
      label = t("chipClosed");
      ariaLabel = t("chipClosedAria");
      break;
    case "linked":
      label = labelize(row.jobStatus ?? "");
      ariaLabel = t("chipLinkedAria", { status: row.jobStatus ?? "" });
      break;
    default:
      label = t("chipUnlinked");
      ariaLabel = t("chipUnlinkedAria");
  }
  return <Badge tone={chip.tone} icon={chip.icon} label={label} ariaLabel={ariaLabel} muted={muted} />;
}

// Seniority as a single lucide glyph (icon-only column). The word is the tooltip +
// screen-reader name — localized via the shared enums.seniority catalog (so it
// doesn't drift from the rest of the app); an unknown/absent value degrades to an
// em dash. seniorityMeta stays the single authority for the icon.
export function SeniorityCell({ value }: { value: string | null | undefined }) {
  const enumLabel = useEnumLabel();
  const meta = seniorityMeta(value);
  if (!meta) return <span className="text-stone-400">—</span>;
  const Icon = meta.icon;
  const label = enumLabel("seniority", value);
  return (
    <span className="inline-flex items-center text-steel" title={label}>
      <Icon size={16} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
