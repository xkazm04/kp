import { notFound } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { verifySkillProfileToken } from "@/app/_lib/db/skill-profiles";
import { skillProfileFreshnessNow, resolveSkillProfileCardState, skillProfileShowsScoreCard } from "@/app/_lib/skill-profile";


// Durable Skill Profile (moonshot A) — the public, candidate-owned, shareable
// score-card. Token-gated (mirrors /offer/[token]); renders the signed credential
// and a tamper-evident "verified by kp" verdict computed server-side. Explainable
// by construction: shows the durable axes + propagated confidence + a methodology
// link, never just a bare number.
// Blocked under Cache Components: dynamic per-request route (previously
// force-dynamic) with no useful static shell to prerender.
export const instant = false;

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
  //
  // "unverifiable" comes BEFORE "tampered": when kp cannot check the signature because the
  // credential key is unset/misconfigured server-side (verdict.verifiable === false), that
  // is OUR configuration problem, not evidence the bearer forged anything. It renders a
  // NEUTRAL "cannot verify" badge — never the red fraud accusation — so a KP_SECRET rotation
  // or a missing KP_SKILL_PROFILE_KEY can't defame a genuine, non-revoked credential.
  //
  // "stale" is the LAST downgrade (bug-ui-scan-2026-07-09 (skill-matrix-coverage #3)): a
  // genuine, non-revoked, untampered, substantive credential that is nonetheless OLD (issued
  // past the validity window) or signed under a superseded methodology. The green shield
  // over-asserts freshness — a third party reads "Verified" as "current" — so a stale
  // credential drops to a muted amber "issued a while ago" verdict with the numbers still
  // shown, never a confident green. Integrity is unaffected; only currency is flagged.
  const freshness = skillProfileFreshnessNow(p);
  const state = resolveSkillProfileCardState({
    revoked: verdict.revoked,
    verifiable: verdict.verifiable,
    valid: verdict.valid,
    substantive: verdict.substantive,
    stale: freshness.stale,
  });

  const badge =
    state === "verified"
      ? { Icon: ShieldCheck, cls: "border-green-200 bg-green-50 text-green-800", label: t("verified") }
      : state === "revoked"
        ? { Icon: ShieldX, cls: "border-stone-300 bg-stone-100 text-steel", label: t("revoked") }
        : state === "incomplete"
          ? { Icon: ShieldAlert, cls: "border-stone-300 bg-stone-100 text-steel", label: t("incomplete") }
          : state === "unverifiable"
            ? { Icon: ShieldAlert, cls: "border-stone-300 bg-stone-100 text-steel", label: t("unverifiable") }
            : state === "stale"
              ? { Icon: ShieldAlert, cls: "border-amber-200 bg-amber-50 text-amber-800", label: t("stale") }
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

      {/* A stale credential stays genuine — say so plainly and name why (old / superseded
          methodology) so an employer reads "still real, just not current", not "fake". */}
      {state === "stale" ? (
        <p className="mt-2 max-w-xl text-sm text-amber-700">
          {freshness.reason === "methodology"
            ? t("staleMethodology", { issued, version: p.version })
            : t("staleAge", { issued, version: p.version })}
        </p>
      ) : null}

      {/* bug-ui-scan-2026-07-09 (dev-lifecycle-cohort-outcomes #2): gate the numeric score
          card on the full TRUST state (verified/stale = genuine, attested), NOT on
          `substantive` alone. A tampered/revoked/unverifiable credential can still be
          "substantive" (has numbers), so the old gate rendered attacker-/stale-controlled
          scores as the visual focus directly under a red "do not trust" badge. Untrusted or
          unattested states now withhold the numbers entirely; `incomplete` explains the
          absence in the muted block below, the rest are already fully named by the badge. */}
      {skillProfileShowsScoreCard(state) ? (
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
              {axes.map(([name, score]) => {
                const pct = Math.max(0, Math.min(100, score));
                return (
                <li key={name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">{name}</span>
                    <span className="font-mono text-stone-500">{Math.round(score)}</span>
                  </div>
                  {/* bug-ui-scan-2026-07-09 (dev-lifecycle-cohort-outcomes #5): the axis meter
                      was a purely presentational div — no role/value, so assistive tech got the
                      number with no notion of scale, and a 0-score axis rendered a visually
                      empty track indistinguishable from "no data". Expose it as a labelled
                      meter, and draw a faint baseline tick at score 0 so an empty bar reads as
                      "low", not "missing". */}
                  <div
                    role="meter"
                    aria-valuenow={Math.round(pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t("axisMeterLabel", { axis: name, score: Math.round(score) })}
                    className="mt-1 h-1.5 w-full rounded-full bg-stone-100"
                  >
                    {pct > 0 ? (
                      <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
                    ) : (
                      <div className="h-full w-1 rounded-full bg-stone-300" aria-hidden />
                    )}
                  </div>
                </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </section>
      ) : state === "incomplete" ? (
        // `summaryUnavailable` says the credential "was issued without a scored skill
        // summary" — TRUE only of `incomplete`. When the score gate widened from
        // `substantive` alone to the full trust state (the note above), the other three
        // withheld states started falling into this block too, so a REVOKED or TAMPERED
        // credential — which does carry numbers, we are simply refusing to vouch for them —
        // told the reader it had been issued empty, and an UNVERIFIABLE one (our own key
        // misconfigured) blamed the issuance for a server-side problem. A false statement
        // about what kp issued is worse than no statement, and the badge above already
        // names each of those three states in full ("This credential has been revoked",
        // "Signature invalid, do not trust", "Verification temporarily unavailable"), so
        // they now render the badge alone. Per-state body copy is a follow-up: it needs
        // new keys in all four locale catalogs.
        <section className="mt-6 rounded-lg border border-stone-200 bg-paper p-6 text-sm text-steel">
          {t("summaryUnavailable")}
        </section>
      ) : null}

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
