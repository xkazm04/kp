"use client";

// The recruiter's own offer draft (draft_offer on POST /api/pipeline/[id]): a figure, or
// the role's band midpoint when left empty. It only creates the draft; sending is the
// same offer approval every draft goes through.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import { useWorkspaceMarket } from "@/app/_lib/use-workspace-market";
import { useErrorMessage } from "@/app/_lib/use-error-message";

export function ManualOfferPanel({ entryId, onChanged }: { entryId: string; onChanged: () => void }) {
  const t = useTranslations("pipeline.candidate.footer");
  // The draft is denominated in the workspace's market (offer-manual-draft.ts).
  const marketCurrency = useWorkspaceMarket().currency;
  const errMsg = useErrorMessage();
  const [salary, setSalary] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/${encodeURIComponent(entryId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_offer", salary: salary.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errMsg(body, t("manualOfferFailed")));
      setDone(true);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("manualOfferFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p role="status" className="text-meta font-semibold text-moss">
        {t("manualOfferDrafted")}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <label htmlFor="manual-offer-salary" className={META_LABEL}>
        {t("manualOfferAmount", { currency: marketCurrency })}
      </label>
      <input
        id="manual-offer-salary"
        type="number"
        min={0}
        inputMode="numeric"
        value={salary}
        onChange={(e) => setSalary(e.target.value)}
        disabled={busy}
        className={`${FIELD} h-9 w-48`}
      />
      <p className="text-meta text-steel">{t("manualOfferHint")}</p>
      <button type="button" onClick={() => void submit()} disabled={busy} aria-busy={busy} className={`${BTN_PRIMARY} h-9 cursor-pointer px-4 text-meta`}>
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} {t("manualOfferSubmit")}
      </button>
      {error ? (
        <p role="alert" className="text-meta text-coral-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
