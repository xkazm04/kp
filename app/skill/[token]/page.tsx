import { notFound } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { verifySkillProfileToken } from "@/app/_lib/db";

export const dynamic = "force-dynamic";

// Durable Skill Profile (moonshot A) — the public, candidate-owned, shareable
// score-card. Token-gated (mirrors /offer/[token]); renders the signed credential
// and a tamper-evident "verified by kp" verdict computed server-side. Explainable
// by construction: shows the durable axes + propagated confidence + a methodology
// link, never just a bare number.
export default async function SkillProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verdict = verifySkillProfileToken(token);
  if (!verdict.found || !verdict.profile) notFound();

  const t = await getTranslations("skillProfile");
  const p = verdict.profile;
  const axes = Object.entries(p.axes);
  const confidencePct = Math.round((p.confidence ?? 0) * 100);
  const issued = p.issuedAt.slice(0, 10);
  // A validly-signed but SUBSTANTIVELY EMPTY credential (no axes, transfer score 0) is
  // NOT a confident "verified" verdict — it's an "incomplete" attestation, shown muted
  // so a third party never reads a green shield over a 0.
  const state: "verified" | "revoked" | "tampered" | "incomplete" = verdict.revoked
    ? "revoked"
    : !verdict.valid
      ? "tampered"
      : !verdict.substantive
        ? "incomplete"
        : "verified";

  const badge =
    state === "verified"
      ? { Icon: ShieldCheck, cls: "border-emerald-200 bg-emerald-50 text-emerald-800", label: t("verified") }
      : state === "revoked"
        ? { Icon: ShieldX, cls: "border-stone-300 bg-stone-100 text-steel", label: t("revoked") }
        : state === "incomplete"
          ? { Icon: ShieldAlert, cls: "border-stone-300 bg-stone-100 text-steel", label: t("incomplete") }
          : { Icon: ShieldAlert, cls: "border-red-200 bg-red-50 text-red-800", label: t("tampered") };

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
      <h1 className="mt-1 font-serif text-display text-ink">{t("title")}</h1>
      <p className="mt-2 text-body text-steel">{t("subtitle")}</p>

      <div className={`mt-4 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${badge.cls}`}>
        <badge.Icon className="h-4 w-4" aria-hidden />
        {badge.label}
      </div>

      {verdict.substantive ? (
      <section className="mt-6 rounded-lg border border-stone-200 bg-white p-6 shadow-panel">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="font-serif text-display leading-none text-ink">{Math.round(p.transferScore)}</div>
            <div className="mt-1 text-sm text-steel">{t("transferLabel")}</div>
          </div>
          <div className="text-right text-sm text-stone-500">
            <div>
              {t("confidenceLabel")}: <b className="text-ink">{confidencePct}%</b>
            </div>
            <div className="mt-0.5">
              {t("issuedLabel")}: {issued}
            </div>
          </div>
        </div>

        {axes.length > 0 ? (
          <div className="mt-6">
            <h2 className="text-meta uppercase text-steel">{t("axesLabel")}</h2>
            <ul className="mt-2 space-y-2">
              {axes.map(([name, score]) => (
                <li key={name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">{name}</span>
                    <span className="font-mono text-stone-500">{Math.round(score)}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-stone-100">
                    <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
      ) : (
        <section className="mt-6 rounded-lg border border-stone-200 bg-paper p-6 text-sm text-steel">
          {t("summaryUnavailable")}
        </section>
      )}

      <p className="mt-4 text-xs text-stone-400">
        {t("methodology")}{" "}
        <Link href="/about" className="underline">
          {t("methodologyLink")}
        </Link>
        . {t("version", { version: p.version })}
      </p>
    </main>
  );
}
