"use client";

import { useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { formatCount } from "@/app/_components/kit";
import type { StageDef } from "@/app/features/shared/pipelineTypes";
import { stageName } from "../kit/pipelineKitMoves";
import { NONE, type LensId } from "./orbitModel";

/** Every word the orbit shows that is not a sentence of its own: group, stage and approval-kind names, counts. */
export function useOrbitWords(axis: readonly StageDef[]) {
  const t = useTranslations("pipeline.orbit");
  const tk = useTranslations("pipeline.kit");
  const enumLabel = useEnumLabel();
  const locale = useLocale();
  const n = useCallback((v: number) => formatCount(v, locale), [locale]);
  const stage = useCallback((id: string) => stageName(id, axis, (x) => enumLabel("stage", x)), [axis, enumLabel]);
  const group = useCallback(
    (lens: LensId, key: string) => {
      if (key === NONE) return t(`none.${lens}`);
      if (lens === "family") return enumLabel("family", key);
      if (lens === "seniority") return enumLabel("seniority", key);
      return key;
    },
    [t, enumLabel]
  );
  const kind = useCallback(
    (k: string) => {
      const key = `approval.${k}` as Parameters<typeof tk>[0];
      return tk.has(key) ? tk(key) : enumLabel("approval", k);
    },
    [tk, enumLabel]
  );
  return useMemo(() => ({ t, n, stage, group, kind, locale, enumLabel }), [t, n, stage, group, kind, locale, enumLabel]);
}

export type OrbitWords = ReturnType<typeof useOrbitWords>;
