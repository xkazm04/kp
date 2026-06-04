"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { SCREENING_DEFAULT as FALLBACK, type ScreeningRule } from "@/app/_lib/decision-config-schema";

// Type + default come from the pure decision-config-schema module — the same
// source the API validates writes against — so the client clamps and the server
// contract can't drift.

// Phase 3 — configure the per-phase decision rules. Today: the screening
// "first wave" auto-reject (off by default). Early-career is never auto-rejected
// — that fairness gate is enforced in code, not configurable.
export function DecisionRulesModal({ onClose }: { onClose: () => void }) {
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
      setNote("Saved.");
    } catch {
      setNote("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Decision rules · Screening"
      subtitle="The first automated decision wave"
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
            {saving ? <Loader2 size={15} className="animate-spin" /> : null} Save rules
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
        <p className="text-sm text-steel">Loading…</p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={rule.autoRejectEnabled}
              onChange={(e) => setRule({ ...rule, autoRejectEnabled: e.target.checked })}
              className="h-4 w-4 accent-coral"
            />
            <span className="text-sm font-semibold text-ink">Auto-reject the weakest matches at screening</span>
          </label>

          <div className={`grid grid-cols-2 gap-3 ${rule.autoRejectEnabled ? "" : "opacity-50"}`}>
            <label className="block">
              <span className="mb-1 block text-sm text-steel">Reject bottom %</span>
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
              <span className="mb-1 block text-sm text-steel">…only if match below</span>
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
            Reject the bottom <strong>{rule.rejectBottomPercent}%</strong> of a role&apos;s matched candidates whose match is
            also below <strong>{rule.maxMatchToReject}</strong>
            {rule.rejectBottomPercent > 0 ? (
              <>
                {" "}
                — rounded down, but <strong>at least the single weakest</strong> candidate in any non-empty pool, so a small
                role is never silently skipped
              </>
            ) : null}
            . Every auto-decision is logged with a rationale (see Analytics).
          </p>
          <p className="text-sm text-steel">
            <span className="font-semibold text-moss">Fairness:</span> early-career candidates (student / career-switcher) are{" "}
            <strong>never</strong> auto-rejected — that gate is enforced in code.
          </p>
        </div>
      )}
    </Modal>
  );
}
