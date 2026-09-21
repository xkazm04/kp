"use client";

import { useTranslations } from "next-intl";

// The kit's one door to the catalogs.
//
// Every string the kit renders is chrome — "Hide: Conversation", "Thinking…",
// "None of these" — and which CATALOG BRANCH it comes from is a per-consumer
// prop (`ns`): intake reads its own tab's branch, the job-seeker dialogs read
// `me.*`. next-intl's `useTranslations` is typed against the `en` catalog, so a
// namespace that arrives at runtime cannot be checked at compile time; this
// helper is where that one cast lives, so no component in the kit carries it.
//
// The price is stated once, here: a kit key missing from a consumer's branch
// is a RUNTIME miss (next-intl logs and renders the key), not a `tsc` error.
// Each consumer owes the kit the keys listed in STUDIO_KEYS below, and
// `npm run i18n:check` keeps whatever it ships in all four catalogs.

/** The relative keys the kit reads under `<ns>` — the consumer's obligation. */
export const STUDIO_KEYS = [
  "studio.closeBusy",
  "studio.closeStay",
  "studio.closeAnyway",
  "columns.col.<zone>",
  "columns.hide",
  "columns.show",
  "composer.transcriptLabel",
  "roles.agent",
  "roles.requestor",
  "roles.system",
  "compactedNote",
  "thinking",
  "error",
  "choices.eyebrowConfirm",
  "choices.eyebrowPropose",
  "choices.confirmSelection",
  "choices.none",
  "glyph.compose",
  "glyph.send",
  "glyph.dictate",
  "glyph.dictateOff",
  "glyph.speak",
  "glyph.speakOff",
  "glyph.autoSpeak",
  "voiceIo.dictating",
  "voiceIo.speaking",
] as const;

export type StudioTranslator = {
  (key: string, values?: Record<string, string | number | Date>): string;
  has(key: string): boolean;
};

export function useStudioTranslations(ns: string): StudioTranslator {
  // The namespace is a consumer prop, so it cannot satisfy the typed overload;
  // the runtime call is exactly the same.
  const t = useTranslations(ns as Parameters<typeof useTranslations>[0]);
  return t as unknown as StudioTranslator;
}
