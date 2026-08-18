"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { copyText } from "@/app/_lib/export-utils";
import { FIELD } from "@/app/_components/ui/recipes";
import { analyticsViewUrl } from "./analyticsViewLink";
import type { AnalyticsSectionId } from "./sections/analyticsSections";

// UAT TOM-ANA-8 — "when my VP asks for the number we are arguing about, what I
// send should land them where I am."
//
// The address bar cannot be that artifact (analyticsViewLink.ts explains why, and
// why the inbox stays as it is), so the link is minted explicitly instead. It sits
// in the always-rendered header, beside the metric-pack download: the two things a
// reader mid-argument reaches for are "give me the file" and "give me the link",
// and both belong above the section they are about rather than at the end of a
// scroll.
//
// Truthfulness (the house rule this whole drain is about): `copyText` reports
// whether the clipboard actually took it. A blocked clipboard — an insecure origin,
// a denied permission — must NOT print "Link copied"; it falls back to the URL in a
// selectable field, which is the honest version of the same help.
export function AnalyticsCopyViewLink({ section, days }: { section: AnalyticsSectionId; days: number | null }) {
  const t = useTranslations("analytics");
  const [state, setState] = useState<{ kind: "idle" | "copied" } | { kind: "manual"; url: string }>({ kind: "idle" });

  const copy = async () => {
    // SSR never runs this handler; the guard keeps the component safe to render on
    // the server, where there is no origin to resolve.
    const url = analyticsViewUrl({
      origin: typeof window === "undefined" ? "" : window.location.origin,
      section,
      days,
    });
    if (await copyText(url)) {
      setState({ kind: "copied" });
      window.setTimeout(() => setState((cur) => (cur.kind === "copied" ? { kind: "idle" } : cur)), 2000);
    } else {
      setState({ kind: "manual", url });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={copy}
        title={t("copyViewLinkTitle")}
        className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1 text-sm font-semibold text-steel transition-colors hover:border-coral/40 hover:text-coral"
      >
        {state.kind === "copied" ? (
          <Check size={13} className="text-moss" aria-hidden />
        ) : (
          <Link2 size={13} aria-hidden />
        )}
        {state.kind === "copied" ? t("viewLinkCopied") : t("copyViewLink")}
      </button>
      {/* The confirmation, announced rather than only painted. The button carries a
          `title`, which some engines use as its accessible NAME — in that case the
          label swapping to "Link copied" is silent to a screen reader, and a
          confirmation nobody hears is the same class of defect as one that is not
          true. Rendered always (empty when idle) so the region exists before it
          changes; live regions inserted at the same moment as their text are
          unreliably announced. */}
      <span role="status" aria-live="polite" className="sr-only">
        {state.kind === "copied" ? t("viewLinkCopied") : ""}
      </span>
      {/* The fallback is a status, not an error: nothing failed on our side and the
          reader still gets the link. role="status" so it is announced rather than
          only painted — the button they just pressed did not do what its label said
          it would. */}
      {state.kind === "manual" ? (
        <span role="status" className="flex w-full flex-col gap-1">
          <span className="text-meta text-steel">{t("viewLinkManual")}</span>
          <input
            readOnly
            value={state.url}
            aria-label={t("copyViewLink")}
            onFocus={(e) => e.currentTarget.select()}
            className={`focus-ring ${FIELD} w-full max-w-xl py-1 text-sm`}
          />
        </span>
      ) : null}
    </>
  );
}
