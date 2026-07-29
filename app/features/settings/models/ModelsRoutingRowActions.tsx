"use client";

import { useTranslations } from "next-intl";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";

// The save/test/reset button cluster for one routing row. Split out of
// ModelsRoutingRow.tsx.
export function ModelsRoutingRowActions({
  useCase,
  hasRow,
  canSave,
  busy,
  onSave,
  onTest,
  onReset,
}: {
  useCase: string;
  hasRow: boolean;
  canSave: boolean;
  busy: "save" | "reset" | "test" | null;
  onSave: () => void;
  onTest: () => void;
  onReset: () => void;
}) {
  const t = useTranslations("models.routing");
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <button type="button" onClick={onSave} disabled={!canSave || busy !== null} className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}>
        {busy === "save" ? t("saving") : t("save")}
      </button>
      {/* The canary route refuses the catch-all (a "*" test would prove
          nothing specific), so the button only renders on real use cases. */}
      {hasRow && useCase !== "*" ? (
        <button type="button" onClick={onTest} disabled={busy !== null} className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}>
          {busy === "test" ? t("testing") : t("test")}
        </button>
      ) : null}
      {hasRow ? (
        <button
          type="button"
          onClick={onReset}
          disabled={busy !== null}
          title={t("resetTitle")}
          className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}
        >
          {busy === "reset" ? t("resetting") : t("reset")}
        </button>
      ) : null}
    </div>
  );
}
