"use client";

import { useTranslations } from "next-intl";
import { isApprovalKind } from "@/app/_lib/approval-kinds";

/** What an entry is waiting on you for, in the reader's language (the six approval kinds). */
export function useApprovalWord(): (kind: string | null | undefined) => string {
  const t = useTranslations("pipeline.kit.approval");
  const tRow = useTranslations("pipeline.candidateRow");
  return (kind) => (isApprovalKind(kind) ? t(kind) : tRow("awaitingDecision"));
}
