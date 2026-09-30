"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Segmented } from "@/app/_components/kit";

// The WP13 prototype switch (the /prototype method, Phase 2): the Summary tab as shipped
// (the baseline, the default) or one of two directional variants, "Dossier" and "Workbench".
// Dev only: `?summary=dossier|workbench|baseline` picks one and remembers it
// (localStorage "kp-gigs-summary"), `?summary=0` forgets it; the switch itself is always shown in
// dev, above the Summary. Production builds always render the baseline, so nothing
// changes for an operator until one direction is picked and consolidated.

export const SUMMARY_VARIANTS = ["baseline", "dossier", "workbench"] as const;
export type SummaryVariant = (typeof SUMMARY_VARIANTS)[number];

const KEY = "kp-gigs-summary";
const EVENT = "kp-gigs-summary";
const isVariant = (v: string | null): v is SummaryVariant => v !== null && (SUMMARY_VARIANTS as readonly string[]).includes(v);

function read(): string {
  if (process.env.NODE_ENV === "production") return "";
  try {
    const q = new URLSearchParams(window.location.search).get("summary");
    if (isVariant(q)) window.localStorage.setItem(KEY, q);
    if (q === "0") window.localStorage.removeItem(KEY);
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    // Storage blocked (private mode, a sandboxed preview): the baseline renders.
    return "";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener("popstate", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** The Summary variant to render, and whether the switch is shown (dev only). */
export function useSummaryVariant(): { variant: SummaryVariant; show: boolean } {
  const stored = useSyncExternalStore(subscribe, read, () => "");
  // Always shown in dev: the operator picks between the variants on the Summary itself (a
  // query param alone was lost when the shell consumed the URL before the proof mounted).
  return { variant: isVariant(stored) ? stored : "baseline", show: process.env.NODE_ENV !== "production" };
}

function choose(v: SummaryVariant) {
  try {
    window.localStorage.setItem(KEY, v);
  } catch {
    // Storage blocked: the choice cannot be kept, so the baseline stays.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The labelled switch above the Summary: the variant's name and one line on its idea. */
export function SummarySwitch({ value }: { value: SummaryVariant }) {
  const t = useTranslations("gigs.summaryProto");
  return (
    <div className="sm-switch">
      <span className="caps dim">{t("label")}</span>
      <Segmented label={t("label")} value={value} onChange={(v) => choose(v as SummaryVariant)} items={SUMMARY_VARIANTS.map((v) => ({ value: v, label: t(`name.${v}`) }))} />
      <span className="t-meta">{t(`sub.${value}`)}</span>
    </div>
  );
}
