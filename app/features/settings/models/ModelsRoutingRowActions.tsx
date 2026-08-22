"use client";

import { useTranslations } from "next-intl";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";

// The save/test/reset button cluster for one routing row. Split out of
// ModelsRoutingRow.tsx.
export function ModelsRoutingRowActions({
  useCase,
  hasRow,
  canSave,
  canTest,
  busy,
  onSave,
  onTest,
  onReset,
}: {
  useCase: string;
  hasRow: boolean;
  canSave: boolean;
  /** False while the row's draft differs from the stored pin — the canary calls
   *  `/api/llm/test` with the use case only, so it can only ever prove what the
   *  SERVER has stored. */
  canTest: boolean;
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
          nothing specific), so the button only renders on real use cases.
          It is disabled while the draft is unsaved for the same reason it is
          absent on an unpinned row: the request carries the use case, not the
          typed provider/model, so a verdict about the stored pin would be read
          as a verdict on the edit sitting in the boxes beside it. Save first. */}
      {hasRow && useCase !== "*" ? (
        <button
          type="button"
          onClick={onTest}
          disabled={!canTest || busy !== null}
          className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}
        >
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
