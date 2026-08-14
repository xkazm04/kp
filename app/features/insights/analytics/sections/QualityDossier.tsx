"use client";

// VARIANT A — "Dossier". Metaphor: the file you hand to a regulator, or to a
// candidate exercising their right to an explanation.
//
// The baseline presents three panels of internal telemetry and leaves the reader
// to assemble a defence. This variant asks what the section is FOR — and the
// answer is that somebody, one day, will ask "why was this person rejected, and
// can you prove the record wasn't edited?" So it opens with the thing that
// answers that: the chain integrity seal, and the export that produces the file.
//
// What differs, structurally:
//   • the tamper-evident verdict is the hero, not a badge inside panel two;
//   • the export is a primary action at the top, not a small button mid-page;
//   • the calibration is demoted to an appendix — in a dossier, "how reliable is
//     the instrument" is supporting evidence for the decisions, not the subject;
//   • the voice is documentary: what is sealed, how many links, as of when.
import { useTranslations } from "next-intl";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { PANEL } from "@/app/_components/ui/recipes";
import { Defer } from "@/app/_components/ui/Defer";
import { CalibrationPanel, DecisionRecordsPanel, DecisionLog } from "./sectionChunks";

type ChainVerdict = { ok: boolean; count: number; brokenAtSeq: number | null };
type Payload = { chain: ChainVerdict };

export function QualityDossier() {
  const t = useTranslations("analytics.quality");
  // The same endpoint the records panel below reads. Fetched again rather than
  // threaded down, because the panel owns its own loading choreography and
  // hoisting the fetch would make the hero wait on the panel's whole payload.
  const { data, error } = useJsonFetch<Payload>("/api/decisions/records");
  const chain = data?.chain ?? null;

  return (
    <div className="animate-arrive-in space-y-6">
      {/* ---- The seal: what a dossier leads with ---------------------------- */}
      <section className={`${PANEL} p-5`}>
        <p className="text-meta uppercase text-coral">{t("dossierEyebrow")}</p>

        {error ? (
          <p className="mt-2 text-base text-steel">{t("chainUnavailable")}</p>
        ) : chain == null ? (
          <div className="reveal-quiet mt-2 min-h-[4rem]" aria-hidden />
        ) : chain.count === 0 ? (
          <>
            <p className="mt-2 font-serif text-h1 leading-tight text-ink">{t("chainEmptyTitle")}</p>
            <p className="mt-2 max-w-2xl text-body leading-relaxed text-steel">{t("chainEmptyBody")}</p>
          </>
        ) : (
          <>
            <p className="mt-2 flex flex-wrap items-center gap-3">
              {chain.ok ? (
                <ShieldCheck size={28} className="shrink-0 text-moss" aria-hidden />
              ) : (
                <ShieldAlert size={28} className="shrink-0 text-coral" aria-hidden />
              )}
              <span className={`font-serif text-h1 leading-tight ${chain.ok ? "text-ink" : "text-coral"}`}>
                {chain.ok ? t("chainSealed", { count: chain.count }) : t("chainBroken", { seq: chain.brokenAtSeq ?? 0 })}
              </span>
            </p>
            <p className="mt-2 max-w-2xl text-body leading-relaxed text-steel">
              {chain.ok ? t("chainSealedBody") : t("chainBrokenBody")}
            </p>
          </>
        )}
      </section>

      {/* ---- The record itself --------------------------------------------- */}
      <Defer strategy="idle">
        <DecisionRecordsPanel />
      </Defer>

      <Defer strategy="visible">
        <DecisionLog />
      </Defer>

      {/* ---- Appendix: the instrument -------------------------------------- */}
      <section className="border-t border-stone-300 pt-6">
        <p className="text-meta uppercase text-steel">{t("appendixLabel")}</p>
        <p className="mb-4 mt-1 max-w-2xl text-body leading-relaxed text-steel">{t("appendixBody")}</p>
        <Defer strategy="visible">
          <CalibrationPanel />
        </Defer>
      </section>
    </div>
  );
}
