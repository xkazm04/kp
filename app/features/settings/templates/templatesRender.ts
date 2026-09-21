"use client";

// Live preview, in the reader's language.
//
// `renderTemplate` (app/features/shared/renderTemplate.ts) is the pure renderer
// the JD build and the library manager already use, and it takes its copy as
// parameters rather than reaching for a catalog — which is exactly what lets it
// be called from a client component like this one. Two things must be supplied:
//
//   • the DATA placeholders, filled here with sample values from the catalog so
//     the preview reads as a finished message rather than as a form; and
//   • the localization TOKENS ({{heading_*}}, {{offer_note}}, {{apply_note}}),
//     read from `library.templates.token` — the same four-locale copy the server
//     loader (app/_lib/jd-template-tokens.ts) resolves for a real build, reached
//     through `useTranslations` because this side has a reader locale and no
//     async loader.
//
// The sample values are catalog keys, not literals: a Czech recruiter previewing
// a Czech template against an English sample company would be reading two
// languages at once.

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  renderTemplate,
  TEMPLATE_LOCALIZED_TOKENS,
  type TemplateData,
  type TemplateTokens,
} from "@/app/features/shared/renderTemplate";

/** Every localization token, resolved for the READER. */
export function useTemplateTokens(): TemplateTokens {
  const t = useTranslations("library.templates.token");
  return useMemo(
    // Built from the tuple rather than an object literal, so the map can never
    // carry fewer keys than the renderer substitutes.
    () => Object.fromEntries(TEMPLATE_LOCALIZED_TOKENS.map((k) => [k, t(k)])) as TemplateTokens,
    [t]
  );
}

/** The sample candidate/role the preview is rendered against. */
export function useSampleTemplateData(): TemplateData {
  const t = useTranslations("templates.sample");
  return useMemo(
    () => ({
      title: t("title"),
      company: t("company"),
      seniority: t("seniority"),
      salary: t("salary"),
      about: t("about"),
      responsibilities: [t("resp1"), t("resp2"), t("resp3")],
      mustHaves: [t("must1"), t("must2")],
      niceToHaves: [t("nice1"), t("nice2")],
    }),
    [t]
  );
}

/** `(body) => rendered markdown`, bound to the reader's sample data + tokens.
 *  Stable across renders, so it is safe in a dependency array. */
export function useTemplatePreview(): (body: string) => string {
  const tokens = useTemplateTokens();
  const data = useSampleTemplateData();
  return useMemo(() => (body: string) => renderTemplate(body, data, tokens), [data, tokens]);
}
