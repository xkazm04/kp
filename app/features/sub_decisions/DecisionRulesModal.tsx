"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { SCREENING_DEFAULT as FALLBACK, type ScreeningRule } from "@/app/_lib/decision-config-schema";
import { ComplianceSection } from "./ComplianceSection";

// Type + default come from the pure decision-config-schema module — the same
// source the API validates writes against — so the client clamps and the server
// contract can't drift.

// Phase 3 — configure the per-phase decision rules. Today: the screening
// "first wave" auto-reject (off by default). Early-career is never auto-rejected
// — that fairness gate is enforced in code, not configurable.
export function DecisionRulesModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("decisions.rules");
  const [rule, setRule] = useState<ScreeningRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/decisions/config")
      .then((r) => r.json())
      .then((p) => setRule({ ...FALLBACK, ...(p.configs?.screening ?? {}) }))
      .catch(() => setRule(FALLBACK));
  }, []);

  const save = async () => {
    if (!rule) return;
    setSaving(true);
    setNote(null);
    try {
      const r = await fetch("/api/decisions/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "screening", config: rule }),
      });
      if (!r.ok) throw new Error();
      // Re-sync from the server's canonical (clamped) config in the response, so the modal
      // shows exactly what was persisted rather than the possibly out-of-range value typed.
      const d = (await r.json().catch(() => null)) as { configs?: { screening?: Partial<ScreeningRule> } } | null;
      if (d?.configs?.screening) setRule({ ...FALLBACK, ...d.configs.screening });
      setNote(t("saved"));
    } catch {
      setNote(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t("title")}
      subtitle={t("subtitle")}
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !rule}
            className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : null} {t("saveRules")}
          </button>
          {note ? (
            <span role="status" aria-live="polite" className="text-sm text-steel">
              {note}
            </span>
          ) : null}
        </div>
      }
    >
      {!rule ? (
        <p className="text-sm text-steel">{t("loading")}</p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={rule.autoRejectEnabled}
              onChange={(e) => setRule({ ...rule, autoRejectEnabled: e.target.checked })}
              className="h-4 w-4 accent-coral"
            />
            <span className="text-sm font-semibold text-ink">{t("autoReject")}</span>
          </label>

          <div className={`grid grid-cols-2 gap-3 ${rule.autoRejectEnabled ? "" : "opacity-50"}`}>
            <label className="block">
              <span className="mb-1 block text-sm text-steel">{t("rejectBottomPct")}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={rule.rejectBottomPercent}
                disabled={!rule.autoRejectEnabled}
                aria-describedby="screening-rule-sentence"
                onChange={(e) => setRule({ ...rule, rejectBottomPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-steel">{t("onlyIfBelow")}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={rule.maxMatchToReject}
                disabled={!rule.autoRejectEnabled}
                aria-describedby="screening-rule-sentence"
                onChange={(e) => setRule({ ...rule, maxMatchToReject: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm"
              />
            </label>
          </div>

          <p id="screening-rule-sentence" className="rounded-md bg-paper p-3 text-sm text-ink">
            {t.rich("ruleSentence", {
              pct: rule.rejectBottomPercent,
              max: rule.maxMatchToReject,
              b: (chunks) => <strong>{chunks}</strong>,
            })}
            {rule.rejectBottomPercent > 0 ? t.rich("ruleWeakest", { b: (chunks) => <strong>{chunks}</strong> }) : null}
            {t("ruleLog")}
          </p>
          <p className="text-sm text-steel">
            <span className="font-semibold text-moss">{t("fairnessLabel")}</span>{" "}
            {t.rich("fairnessBody", { b: (chunks) => <strong>{chunks}</strong> })}
          </p>

          {/* P1-1 — jurisdiction-aware compliance posture + the four-fifths
              adverse-impact primitive (its own config phase, saved independently). */}
          <ComplianceSection />
        </div>
      )}
    </Modal>
  );
}
