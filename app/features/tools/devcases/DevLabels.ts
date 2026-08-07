"use client";

// One place where a devcase enum VALUE becomes a word on screen.
//
// Before this module the same enum could render two different ways on two
// surfaces: `STAGE_LABEL` was looked up through the i18n catalog in
// DevLifecycleRow and rendered raw from the hardcoded English map in
// DevCasesTable, so a Czech workspace showed "collecting" in the table and
// "sbírání" in the row beneath it. Every consumer now goes through these hooks,
// which is what makes that class of split impossible rather than merely fixed.
//
// FALLBACK POLICY, and why it differs per vocabulary:
//
//  - PRODUCER-OWNED sets (stage, probe kind, canary kind) keep a `t.has()` guard.
//    The engine can legitimately introduce a value before its strings land, and a
//    de-underscored raw id is a better degradation than a thrown render. The guard
//    test (`devcase-vocabulary.test.ts`) is what stops that fallback from quietly
//    becoming the normal path — it is the round-22 lesson: a raw-value fallback
//    hid nine missing keys across 23 of 40 rows and every gate stayed green.
//  - UI-OWNED closed sets (probe status) call `t()` directly. There is no producer
//    that can extend them, so a missing key is a bug to surface, not to absorb.
import { useTranslations } from "next-intl";
import type { ProbeStatus } from "./DevTypes";

/** Lifecycle stage id -> the reviewer-facing stage name. */
export function useStageLabel(): (stage: string) => string {
  const t = useTranslations("devcase.stage");
  return (stage: string) => {
    const key = stage as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : stage.replace(/_/g, " ");
  };
}

/** Cover-probe kind (design.py PROBE_KINDS) -> its chip label. The "kind absent"
 *  label deliberately lives OUTSIDE this namespace (`devcase.evalPanel.probeKindUnknown`):
 *  the vocabulary catalogs hold exactly the producer's values and nothing else, so
 *  the guard test can assert equality in BOTH directions without carve-outs. */
export function useProbeKindLabel(): (kind?: string | null) => string {
  const t = useTranslations("devcase.probeKind");
  const fallback = useTranslations("devcase.evalPanel");
  return (kind?: string | null) => {
    const raw = (kind ?? "").trim();
    if (!raw) return fallback("probeKindUnknown");
    const key = raw as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : raw.replace(/_/g, " ");
  };
}

/** Canary kind (seed_materializer.py CANARY_KINDS) -> what the planted flaw IS. */
export function useCanaryKindLabel(): (kind?: string | null) => string {
  const t = useTranslations("devcase.canaryKind");
  return (kind?: string | null) => {
    const raw = (kind ?? "").trim();
    if (!raw) return "";
    const key = raw as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : raw.replace(/_/g, " ");
  };
}

/** Probe-outcome state -> its label. Closed UI-owned set; no fallback by design. */
export function useProbeStatusLabel(): (status: ProbeStatus) => string {
  const t = useTranslations("devcase.probeStatus");
  return (status: ProbeStatus) => t(status);
}

/** Capability name -> its label, for pre-`dimensions` bundles only (current ones
 *  carry their own labels from `_ordered_dimensions`, which stay authoritative). */
export function useDimensionLabel(): (name: string) => string {
  const t = useTranslations("devcase.dimension");
  return (name: string) => {
    const key = name as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : name;
  };
}
