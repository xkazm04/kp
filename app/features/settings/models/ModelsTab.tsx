"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { EYEBROW, INTRO } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";

// Models tab — the LLM provider layer's admin surface
// (docs/architecture/llm-provider-layer.md), split into three switchable
// sections rather than one long scroll:
//
//   Routing      pin a provider/model per use case
//   Quality      the baked bench matrix: per-model ranking + best model per case
//   Keys (BYOM)  the write-only provider key store, and a Test that proves a key
//
// The stack version made the tab a ~4-screen scroll whose parts answer three
// unrelated questions ("what runs where", "what is good", "what am I paying
// with"), and every one of them loaded on entry. Sections are mutually exclusive
// now, so each fetch happens when its section is actually opened — the tab's
// entry payload is the header, the switcher and the routing table.
//
// Usage & cost used to be a fourth panel here. It lives on Billing now: metered
// spend is a billing question, and keeping it next to the plan and the meters
// means one place answers "what did this cost".

// Each section is its own chunk; the switcher mounts one at a time. The chunk gap
// is a quiet reserved box, never a skeleton (docs/design/loading-choreography.md).
const chunkGap = (minHeight: string) => {
  const Gap = () => <div className={`reveal-quiet ${minHeight}`} aria-hidden />;
  Gap.displayName = "ModelsSectionGap";
  return Gap;
};
const RoutingPanel = dynamic(() => import("./ModelsRoutingPanel").then((m) => ({ default: m.ModelsRoutingPanel })), {
  loading: chunkGap("min-h-[26rem]"),
});
const QualityOverview = dynamic(() => import("./ModelsQualityOverview").then((m) => ({ default: m.QualityOverview })), {
  loading: chunkGap("min-h-[20rem]"),
});
const KeysPanel = dynamic(() => import("./ModelsKeysPanel").then((m) => ({ default: m.KeysPanel })), {
  loading: chunkGap("min-h-[16rem]"),
});

const SECTIONS = ["routing", "quality", "keys"] as const;
type Section = (typeof SECTIONS)[number];

export function ModelsTab() {
  const t = useTranslations("models");
  const [section, setSection] = useState<Section>("routing");

  return (
    // Tier 1: header + switcher are chrome and paint immediately; the active
    // section owns its own first-load state, so there is no tab-level aria-busy.
    <section className="stagger-children space-y-6">
      <header>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <SectionTitle className="mt-1">{t("title")}</SectionTitle>
        <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
      </header>

      <SegmentedControl
        label={t("sections.label")}
        value={section}
        onChange={setSection}
        options={SECTIONS.map((id) => ({ value: id, label: t(`sections.${id}`) }))}
      />

      {section === "routing" ? <RoutingPanel /> : null}
      {section === "quality" ? <QualityOverview /> : null}
      {section === "keys" ? <KeysPanel /> : null}
    </section>
  );
}
