// Archetype routing-segment option builder split out of ProfileEditor.tsx. Routing segments
// are REGISTRY-driven, not the static baseline list: every archetype surface (apply
// self-declare, matrix columns, the Python router) accepts any registry id, so a
// recruiter-created archetype must be selectable here too — otherwise opening a profile
// routed to one renders the control with nothing selected and one stray click loses the
// custom routing for good. The baseline ids keep their dedicated `choice.<id>` translations;
// a custom id degrades to the registry's own `label` (same pattern as archetypeApplyLabel in
// app/_lib/apply.ts). While the registry hasn't loaded (or its fetch failed) we fall back to
// the baseline list so the control never collapses to a lone "auto" segment.
import type { ReactNode } from "react";
import type { useTranslations } from "next-intl";
import { ARCHETYPE_CHOICES, type ArchetypeDef } from "@/app/features/shared/profileTypes";

type Translator = ReturnType<typeof useTranslations>;

export function buildArchetypeOptions(
  t: Translator,
  archetypes: ArchetypeDef[],
  choice: string
): { value: string; label: ReactNode }[] {
  const choiceLabel = (id: string) =>
    ARCHETYPE_CHOICES.some((c) => c.v === id) ? t(`choice.${id}` as Parameters<typeof t>[0]) : null;
  // Retired archetypes leave the routing segments — EXCEPT the one this profile is
  // already routed to, which stays selectable (with a "retired" marker) so opening a
  // profile that routed to a since-retired archetype never silently loses its routing.
  const visibleArchetypes = archetypes.filter((a) => !a.archived || a.id === choice);
  const segmentLabel = (a: ArchetypeDef) => {
    const base = choiceLabel(a.id) ?? a.label;
    return a.archived ? (
      <span className="inline-flex items-center gap-1">
        {base}
        <span className="rounded bg-stone-200 px-1 py-0.5 text-micro font-semibold uppercase tracking-wide text-steel">{t("retired")}</span>
      </span>
    ) : (
      base
    );
  };
  return [
    { value: "auto", label: t("choice.auto") },
    ...(visibleArchetypes.length
      ? visibleArchetypes.map((a) => ({ value: a.id, label: segmentLabel(a) }))
      : ARCHETYPE_CHOICES.filter((c) => c.v !== "auto").map((c) => ({ value: c.v, label: choiceLabel(c.v) ?? c.label }))),
  ];
}
