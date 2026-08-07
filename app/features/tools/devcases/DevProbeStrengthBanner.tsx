"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { auditProbeStrength } from "@/app/_lib/devcase-probe-audit";
import type { CoverProbe } from "./DevTypes";

// bb4f5494 — adversarial probe-strength audit. Certifies, structurally, that each
// covert probe can actually discriminate (forces a ≥2-option choice, planted at a
// concrete seam, with a good-vs-naive criterion) and flags dead probes so a human
// never ships a case whose probes can't tell strong from naive. Rendered both at
// the approval gate (before the case goes live) and on the approved case's
// internal panel.
export function ProbeStrengthBanner({ probes }: { probes: CoverProbe[] }) {
  const t = useTranslations("devcase.probeAudit");
  const audit = auditProbeStrength(probes);
  if (audit.total === 0) return null;

  const tone =
    audit.verdict === "strong"
      ? "border-moss/40 bg-moss/10 text-ink"
      : audit.verdict === "weak"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-coral/40 bg-coral/5 text-ink";
  const counts = { loadBearing: audit.loadBearing, total: audit.total };
  const headline =
    audit.verdict === "strong"
      ? t("strong", counts)
      : audit.verdict === "weak"
        ? t("weak", counts)
        : t("none");
  const dead = audit.probes.filter((p) => !p.loadBearing);

  return (
    <div className={`mt-2 rounded-md border px-2.5 py-2 text-micro ${tone}`}>
      <p className="flex items-center gap-1.5 font-semibold">
        {audit.verdict === "strong" ? (
          <ShieldCheck size={12} className="text-moss" />
        ) : (
          <ShieldAlert size={12} className={audit.verdict === "none" ? "text-coral" : "text-amber-700"} />
        )}
        {t("label")} · {headline}
      </p>
      {dead.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {dead.map((p) => (
            <li key={p.probeId || p.where}>
              <span className="rounded bg-white/70 px-1 py-0.5 font-semibold uppercase">{p.kind.replace(/_/g, " ")}</span>{" "}
              <span className="text-steel">@ {p.where || "—"}</span> — {p.issues.join(" ")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
