"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { Select } from "@/app/_components/Select";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { MARKET_IDS, MARKETS, resolveMarketId, type MarketId } from "@/app/_lib/markets";
import { invalidateWorkspaceMarket } from "@/app/_lib/use-workspace-market";

// The market THIS workspace runs in (app/_lib/markets.ts): the currency, pay period and
// hub every compensation figure follows, and whether kp can estimate pay there at all.
// Shown for the session's own workspace only — the route writes the session workspace —
// and editable by whoever can manage teams. Saying what does NOT happen is half the
// control: nothing stored is converted or rewritten.
export function WorkspaceMarket({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations("workspaceAdmin.market");
  const errMsg = useErrorMessage();
  const [marketId, setMarketId] = useState<MarketId | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/workspace/market")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { market?: { id?: unknown } }) => {
        if (live) setMarketId(resolveMarketId(body.market?.id));
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  async function choose(next: string) {
    const id = resolveMarketId(next);
    if (id === marketId || saving) return;
    setSaving(true);
    const res = await fetch("/api/workspace/market", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketId: id }),
    }).catch(() => null);
    if (res?.ok) {
      setMarketId(id);
      invalidateWorkspaceMarket();
      toast.success(t("saved"));
    } else {
      const body = res ? ((await res.json().catch(() => null)) as ApiErrorPayload | null) : null;
      toast.error(body ? errMsg(body, t("failed")) : t("failed"));
    }
    setSaving(false);
  }

  const spec = marketId ? MARKETS[marketId] : null;
  return (
    <div className="border-b border-stone-200 px-5 py-3">
      <label className="text-body font-medium text-ink" htmlFor="workspace-market">
        {t("label")}
      </label>
      {loadFailed ? (
        <p role="alert" className="mt-1 text-meta text-coral-ink">{t("loadFailed")}</p>
      ) : (
        <div className="mt-1 max-w-sm">
          <Select
            id="workspace-market"
            value={marketId ?? ""}
            onChange={(v) => void choose(v)}
            options={MARKET_IDS.map((id) => ({ value: id, label: t(`options.${id}`) }))}
            sizeVariant="sm"
            disabled={!canEdit || saving || marketId === null}
          />
        </div>
      )}
      <p className="mt-1 text-meta text-steel">{t("changes")}</p>
      {spec && !spec.hasBenchmark ? <p className="mt-1 text-meta text-steel">{t("noBenchmark")}</p> : null}
      <p className="mt-1 text-meta text-steel">{t("noRewrite")}</p>
      {!canEdit ? <p className="mt-1 text-meta text-steel">{t("readOnly")}</p> : null}
    </div>
  );
}
