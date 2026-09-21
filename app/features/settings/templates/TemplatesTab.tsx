"use client";

// Settings → Templates: the home for the messages a recruiter sends at each
// pipeline state (CV acknowledged, screened, interview invite, offer cover note,
// rejection).
//
// PROTOTYPE, and labelled as one in the UI: three directional variants sit behind
// a switcher so the shape can be chosen from real use rather than from a
// description. They are three views of ONE data set — the tab owns a single
// `useMessageTemplates()` instance and hands it down, so flipping variants
// re-lays-out the same rows instead of re-fetching them.
//
// Everything below reads and writes the EXISTING /api/templates routes. Nothing
// here adds a store, a column or a migration; see templateKinds.ts for the one
// place that convention has to make up for the schema.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { EYEBROW, INTRO, PAGE_HEADER, SECTION, TITLE_DISPLAY, NOTICE } from "@/app/_components/ui/recipes";
import { TemplatesByStateVariant } from "./TemplatesByStateVariant";
import { TemplatesComposeVariant } from "./TemplatesComposeVariant";
import { TemplatesLibraryVariant } from "./TemplatesLibraryVariant";
import { useMessageTemplates } from "./useMessageTemplates";

const VARIANTS = ["library", "board", "compose"] as const;
type Variant = (typeof VARIANTS)[number];

export function TemplatesTab() {
  const t = useTranslations("templates");
  const [variant, setVariant] = useState<Variant>("library");
  const store = useMessageTemplates();

  return (
    <section className={SECTION}>
      <header className={PAGE_HEADER}>
        <div>
          <p className={EYEBROW}>{t("tab.eyebrow")}</p>
          <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("tab.title")}</h1>
          <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("tab.intro")}</p>
        </div>
        <div className="space-y-1">
          <p className={EYEBROW}>{t("variant.eyebrow")}</p>
          <SegmentedControl
            label={t("variant.label")}
            value={variant}
            onChange={setVariant}
            options={VARIANTS.map((v) => ({ value: v, label: t(`variant.${v}`) }))}
          />
        </div>
      </header>

      {/* The failures a reader must not have to guess at: a list that did not
          load says so (and never renders as "you have no templates"), a bounded
          read says it is partial, and a refused write keeps its coded message
          until the next attempt clears it. */}
      {store.loadFailed ? (
        <div className={`${NOTICE("critical")} px-4 py-3`} role="alert">
          <p>{t("loadFailed")}</p>
          <button type="button" onClick={() => void store.reload()} className="mt-2 cursor-pointer font-semibold underline">
            {t("retry")}
          </button>
        </div>
      ) : null}
      {store.truncated ? <p className={`${NOTICE("amber")} px-4 py-3 text-sm`} role="status">{t("truncated")}</p> : null}
      {store.error ? (
        <div className={`${NOTICE("critical")} px-4 py-3 text-sm`} role="alert">
          {store.error}
        </div>
      ) : null}

      {variant === "library" ? <TemplatesLibraryVariant store={store} /> : null}
      {variant === "board" ? <TemplatesByStateVariant store={store} /> : null}
      {variant === "compose" ? <TemplatesComposeVariant store={store} /> : null}
    </section>
  );
}
