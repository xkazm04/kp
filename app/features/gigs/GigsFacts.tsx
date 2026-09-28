"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { NOTICE } from "@/app/_components/ui/recipes";
import type { Gig } from "@/app/_lib/gigs/types";
import { revealInvisible, type SourceRow } from "./gigsLogic";

// Two facts every gig surface shares: an absence stated in words (never a blank, never a
// zero), and the one way the tab shows a stranger's listing text - framed as untrusted,
// links as plain text, and every invisible character made visible.

export function Absent({ children }: { children: ReactNode }) {
  return <span className="italic text-steel">{children}</span>;
}

/** A stranger's listing text. Never rendered as markup: links stay text, and a
 *  zero-width or direction-control character shows as a marked code point. */
export function UntrustedText({ gig, source }: { gig: Pick<Gig, "bodyText">; source: SourceRow | null }) {
  const t = useTranslations("gigs");
  const segments = revealInvisible(gig.bodyText);
  const hidden = segments.filter((s) => s.kind === "invisible").length;
  return (
    <div>
      <p className="mb-1.5 flex flex-wrap items-center gap-2 text-sm text-steel">
        <span className={`${NOTICE("critical")} inline-block px-2 py-0.5 text-sm font-semibold`}>{t("untrusted.tag")}</span>
        {source ? t("untrusted.note", { host: source.host, chars: gig.bodyText.length }) : t("untrusted.noteForwarded", { chars: gig.bodyText.length })}
        {hidden > 0 ? <span className="font-semibold text-coral">{t("untrusted.invisible", { count: hidden })}</span> : null}
      </p>
      <div className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border-2 border-dashed border-stone-300 bg-paper p-3 text-base leading-relaxed text-ink">
        {segments.map((s, i) =>
          s.kind === "text" ? (
            <span key={i}>{s.text}</span>
          ) : (
            <span key={i} className="mx-px inline-block rounded-sm border border-coral px-1 align-baseline font-mono text-sm font-bold text-coral">
              {s.code}
            </span>
          )
        )}
      </div>
    </div>
  );
}
