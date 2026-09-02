"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { fetchTemplates } from "@/app/features/shared/renderTemplate";
import type { BuildIntent } from "./jdsLedgerArtifacts";

// What produced this JD, said out loud in the detail modal — the two halves of a
// build the ledger used to keep to itself.
//
// 1. BuildHeldBand: runJdBuild refuses to overwrite an edit made during the build,
//    so the generated markdown is filed as a REVISION and the row still flips to
//    "ready". Nothing on the surface said so: the recruiter kept their own text and
//    a fresh AI draft sat unread in the edit history. The band names the outcome and
//    opens straight to that history.
// 2. BuildIntentLine: the template, output language and seniority the build ran
//    with (jds.build_input_json). Stored since the intent-persistence path shipped
//    and read only by Duplicate — so "why does this JD look like this / read in
//    Czech" had no answer on the surface that shows the JD.

export function BuildHeldBand({ onOpenDraft }: { onOpenDraft: () => void }) {
  const t = useTranslations("library.tab");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="min-w-0 flex-1 text-sm text-amber-800">
        <span className="font-semibold">{t("buildHeldChip")}</span>{" "}
        {t("buildHeldBody")}
      </p>
      <button
        type="button"
        onClick={onOpenDraft}
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 hover:border-coral/40"
      >
        <History size={14} aria-hidden /> {t("buildHeldOpenDraft")}
      </button>
    </div>
  );
}

export function BuildIntentLine({ intent }: { intent: BuildIntent }) {
  const t = useTranslations("library.tab");
  const enumLabel = useEnumLabel();
  // The template's NAME is not in the intent (only its stable id is, deliberately —
  // a renamed template must not rewrite history). Resolved from the live list, and
  // only when this JD actually named one: an AI-default build costs no request.
  const [templateName, setTemplateName] = useState<string | null>(null);
  const wantsTemplate = Boolean(intent.templateId);
  useEffect(() => {
    if (!wantsTemplate) return;
    let cancelled = false;
    void fetchTemplates()
      .then((list) => {
        if (cancelled) return;
        setTemplateName(list.find((tpl) => tpl.id === intent.templateId)?.name ?? null);
      })
      .catch(() => {
        // Best-effort provenance: an unreachable template list leaves the row
        // showing the honest "unknown" dash rather than blocking the modal.
        if (!cancelled) setTemplateName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [wantsTemplate, intent.templateId]);

  // A template that no longer exists (deleted since the build) and an unreachable
  // list both resolve to null — the JD was still built through SOMETHING we can no
  // longer name, so the dash is the truthful answer, not "AI default format".
  const template = intent.templateId ? templateName ?? "—" : t("buildIntentAiDefault");
  const facts: [string, string][] = [[t("buildIntentTemplate"), template]];
  if (intent.lang) facts.push([t("buildIntentLanguage"), intent.lang.toUpperCase()]);
  if (intent.seniority) facts.push([t("buildIntentSeniority"), enumLabel("seniority", intent.seniority)]);

  return (
    <div className="rounded-lg border border-stone-200 bg-paper/40 px-4 py-3">
      <p className={META_LABEL}>{t("buildIntentLabel")}</p>
      <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        {facts.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <dt className="text-sm text-steel">{label}</dt>
            <dd className="text-sm font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
