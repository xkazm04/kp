"use client";

// Degraded-intake recovery banner: shown when a stub failed intake
// normalization, with a "mark captured" action that clears the flag once the
// profile is captured manually. Split out of PipelineCandidateDrawer.tsx.

import { AlertTriangle, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";

export function PipelineDegradedIntakeBanner({
  reason,
  resolving,
  intakeErr,
  onResolve,
}: {
  reason: string | null | undefined;
  resolving: boolean;
  intakeErr: string | null;
  onResolve: () => void;
}) {
  const t = useTranslations("pipeline.drawer");
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-red-700">
        <AlertTriangle size={13} /> {t("intakeDegradedTitle")}
      </p>
      <p className="mt-1 text-sm text-ink">
        {t.rich("intakeDegradedBody", { b: (chunks) => <span className="font-semibold">{chunks}</span> })}
      </p>
      {reason ? (
        <p className="mt-1.5 break-words rounded bg-white/70 px-2 py-1 font-mono text-meta text-steel">{reason}</p>
      ) : null}
      <button
        type="button"
        onClick={onResolve}
        disabled={resolving}
        className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
      >
        <Wrench size={13} /> {resolving ? t("resolving") : t("markCaptured")}
      </button>
      <p className="mt-1 text-meta text-steel">{t("clearsFlagNote")}</p>
      {intakeErr ? <p role="alert" className="mt-1.5 text-sm text-red-700">{intakeErr}</p> : null}
    </div>
  );
}
