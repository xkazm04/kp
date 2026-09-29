"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { DraftLintFinding } from "@/app/_lib/gigs/draft-lint";
import { useGigsFormat } from "../data/useGigsFormat";

// The pre-send lint's findings in the reader's language (app/_lib/gigs/draft-lint.ts names
// each by a `gigs.lint` catalog key and its ICU params). The proof slip and the margin
// notes (proof/ProofSlip.tsx, proof/Galley.tsx) both say a finding through this one hook.

export function useLintText() {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  return useCallback(
    (f: DraftLintFinding): string => {
      const params: Record<string, string | number> = { ...f.params };
      if (typeof params.deadline === "string") params.deadline = fmt.date(params.deadline);
      if (typeof params.kind === "string") params.kind = t.has(`evidenceKind.${params.kind}` as Parameters<typeof t>[0]) ? t(`evidenceKind.${params.kind}` as Parameters<typeof t>[0]) : params.kind;
      return t(`lint.${f.messageKey}` as Parameters<typeof t>[0], params as never);
    },
    [t, fmt]
  );
}
