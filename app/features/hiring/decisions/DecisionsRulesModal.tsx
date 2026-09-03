"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { Checkbox } from "@/app/_components/Checkbox";
import { TextInput } from "@/app/_components/TextInput";
import { type ScreeningRule } from "@/app/_lib/decision-config-schema";
import { readScreeningRule, readScreeningRuleResponse, type ScreeningRuleRead } from "./decisionsRulesLoad";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { capabilityAwareReason } from "@/app/_lib/useAddToPipeline";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ComplianceSection } from "./DecisionsComplianceSection";
import { familyFloorEntries, familyFloorSummaryList } from "./decisionsFloorDisclosure";

// Type + default come from the pure decision-config-schema module — the same
// source the API validates writes against — so the client clamps and the server
// contract can't drift.

// Phase 3 — configure the per-phase decision rules. Today: the screening
// "first wave" auto-reject (off by default). Early-career is never auto-rejected
// — that fairness gate is enforced in code, not configurable.
export function DecisionRulesModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("decisions.rules");
  const enumLabel = useEnumLabel();
  const [rule, setRule] = useState<ScreeningRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // reinstate-and-rules-say-when-they-fail — a failed config read used to land on
  // `setRule(FALLBACK)`, and an empty payload was spread over the same defaults: this
  // screen then showed the DEFAULT auto-reject thresholds as if they were the
  // workspace's live rules, and a save would have written them over the real ones.
  // A read that did not produce a screening rule now says so and disables save.
  const [loadFailed, setLoadFailed] = useState<ScreeningRuleRead["failure"]>(null);
  const errMsg = useErrorMessage();

  // Fetch only — every state write happens on the settle, so this is the plain
  // fetch-in-effect pattern rather than a synchronous set during render/effect.
  const fetchRule = useCallback(() => {
    // The BODY is read on a non-OK status too: a capability refusal answers with a
    // code (and the permission it wanted), which is the difference between "ask for
    // access" and "try again" - dropping it to `null` made both look like an outage.
    fetch("/api/decisions/config")
      .then((r) => r.json().then((p: unknown) => readScreeningRuleResponse(r.status, p)))
      .catch(() => readScreeningRuleResponse(null, null)) // offline / aborted / non-JSON
      .then((read) => {
        setRule(read.rule);
        setLoadFailed(read.failure);
      });
  }, []);
  useEffect(() => {
    fetchRule();
  }, [fetchRule]);
  const retryLoad = () => {
    setLoadFailed(null); // back to the loading line while the retry is in flight
    fetchRule();
  };

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
      const d = (await r.json().catch(() => null)) as
        | { configs?: { screening?: Partial<ScreeningRule> }; code?: string; capability?: string }
        | null;
      // A refused save says WHY, from its code, in the reader's language - the write
      // door is capability-gated, and "Couldn't save" told a viewer nothing.
      if (!r.ok) {
        setNote(capabilityAwareReason(errMsg, d, t("saveFailed")));
        return;
      }
      // Re-sync from the server's canonical (clamped) config in the response, so the modal
      // shows exactly what was persisted rather than the possibly out-of-range value typed.
      const saved = readScreeningRule(d);
      if (saved) setRule(saved);
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
            disabled={saving || !rule || loadFailed}
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
      {loadFailed ? (
        // Never a silent default: say the live rules could not be read, and offer the retry.
        <div role="alert" className="space-y-2">
          <p className="text-sm font-semibold text-coral">{capabilityAwareReason(errMsg, loadFailed, t("loadFailed"))}</p>
          <button
            type="button"
            onClick={retryLoad}
            className="focus-ring rounded-md border border-stone-200 bg-white px-3 py-1 text-sm font-semibold text-ink hover:bg-paper"
          >
            {t("loadRetry")}
          </button>
        </div>
      ) : !rule ? (
        <p className="text-sm text-steel">{t("loading")}</p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <Checkbox
              checked={rule.autoRejectEnabled}
              onChange={(e) => setRule({ ...rule, autoRejectEnabled: e.target.checked })}
            />
            <span className="text-sm font-semibold text-ink">{t("autoReject")}</span>
          </label>

          <div className={`grid grid-cols-2 gap-3 ${rule.autoRejectEnabled ? "" : "opacity-50"}`}>
            <label className="block">
              <span className="mb-1 block text-sm text-steel">{t("rejectBottomPct")}</span>
              <TextInput
                type="number"
                min={0}
                max={100}
                value={rule.rejectBottomPercent}
                disabled={!rule.autoRejectEnabled}
                aria-describedby="screening-rule-sentence"
                onChange={(e) => setRule({ ...rule, rejectBottomPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                sizeVariant="sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-steel">{t("onlyIfBelow")}</span>
              <TextInput
                type="number"
                min={0}
                max={100}
                value={rule.maxMatchToReject}
                disabled={!rule.autoRejectEnabled}
                aria-describedby="screening-rule-sentence"
                onChange={(e) => setRule({ ...rule, maxMatchToReject: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                sizeVariant="sm"
              />
            </label>
          </div>

          {(() => {
            // floors-tell-the-truth — the saved per-family overrides ARE in effect at
            // screening (effectiveFloor merges them), so the plain-English rule must name
            // them instead of implying the single global floor governs every family.
            const floors = familyFloorEntries(rule.familyFloors, rule.maxMatchToReject, (slug) => enumLabel("family", slug));
            return (
              <>
                <p id="screening-rule-sentence" className="rounded-md bg-paper p-3 text-sm text-ink">
                  {t.rich("ruleSentence", {
                    pct: rule.rejectBottomPercent,
                    max: rule.maxMatchToReject,
                    b: (chunks) => <strong>{chunks}</strong>,
                  })}
                  {floors.length > 0
                    ? t.rich("ruleFamilyAppend", {
                        count: floors.length,
                        list: familyFloorSummaryList(floors),
                        b: (chunks) => <strong>{chunks}</strong>,
                      })
                    : null}
                  {rule.rejectBottomPercent > 0 ? t.rich("ruleWeakest", { b: (chunks) => <strong>{chunks}</strong> }) : null}
                  {t("ruleLog")}
                </p>
                {floors.length > 0 ? (
                  // Read-only chips — the value lives here for review; editing belongs to the
                  // calibration surface (the hint below points there), so the two never diverge.
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-meta uppercase tracking-wide text-steel">{t("familyOverridesLabel")}</span>
                    {floors.map((f) => (
                      <span
                        key={f.family}
                        className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-0.5 text-meta text-ink"
                      >
                        <span className="font-semibold">{f.label}</span>
                        <span className="nums text-steel">{t("familyFloorChip", { floor: f.floor })}</span>
                      </span>
                    ))}
                    <span className="w-full text-meta text-steel">{t("familyEditHint")}</span>
                  </div>
                ) : null}
              </>
            );
          })()}
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
