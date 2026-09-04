"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { META_LABEL, NOTICE } from "@/app/_components/ui/recipes";
import { fetchTemplates } from "@/app/features/shared/templatesClient";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
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
  // The client never renders the server's English — app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  // The template's NAME is not in the intent (only its stable id is, deliberately —
  // a renamed template must not rewrite history). Resolved from the live list, and
  // only when this JD actually named one: an AI-default build costs no request.
  const [templateName, setTemplateName] = useState<string | null>(null);
  // The list could not be READ — a different fact from "the template is gone",
  // and this line's whole job is to be truthful about what produced the JD. The
  // dash used to cover both, so an unreachable service read on screen as a
  // deleted template. Resolved from the machine code in the reader's language.
  const [lookupFailed, setLookupFailed] = useState<ApiErrorPayload | null>(null);
  const wantsTemplate = Boolean(intent.templateId);
  useEffect(() => {
    if (!wantsTemplate) return;
    let cancelled = false;
    void fetchTemplates().then(({ templates, failed }) => {
      if (cancelled) return;
      // The PAYLOAD is stored, not a resolved sentence: `t`/`errMsg` would then
      // have to be effect dependencies, and re-running this effect on a
      // translator identity change is a refetch loop waiting to happen. The
      // message is resolved at render, where the reader's locale already is.
      setLookupFailed(failed);
      setTemplateName(templates.find((tpl) => tpl.id === intent.templateId)?.name ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [wantsTemplate, intent.templateId]);

  // A template that no longer exists (deleted since the build) resolves to null —
  // the JD was still built through SOMETHING we can no longer name, so the dash is
  // the truthful answer, not "AI default format". An unreachable LIST used to land
  // on the same dash and therefore read as a deletion; it now says so on its own
  // line below, so the dash means exactly one thing again.
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
      {lookupFailed ? (
        <p role="status" className={`${NOTICE("amber")} mt-2 px-3 py-1.5 text-sm`}>
          {errMsg(lookupFailed, t("buildIntentTemplateUnknown"))}
        </p>
      ) : null}
    </div>
  );
}
