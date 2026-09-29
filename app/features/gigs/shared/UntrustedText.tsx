"use client";

import { useTranslations } from "next-intl";
import type { Gig } from "@/app/_lib/gigs/types";
import { revealInvisible } from "../logic/untrusted";
import type { SourceRow } from "../logic/wire";

// The one way the tab shows a stranger's listing text: framed as untrusted (styled in
// styles/records.css `.uf`), links as plain text, and every invisible character made visible.

/** A stranger's listing text. Never rendered as markup: links stay text, and a
 *  zero-width or direction-control character shows as a marked code point. */
export function UntrustedText({ gig, source }: { gig: Pick<Gig, "bodyText">; source: SourceRow | null }) {
  const t = useTranslations("gigs");
  const segments = revealInvisible(gig.bodyText);
  const hidden = segments.filter((s) => s.kind === "invisible").length;
  return (
    <div className="uf">
      <p className="uf-head">
        <span className="uf-tag">{t("untrusted.tag")}</span>
        <span>{source ? t("untrusted.note", { host: source.host, chars: gig.bodyText.length }) : t("untrusted.noteForwarded", { chars: gig.bodyText.length })}</span>
        {hidden > 0 ? <span className="uf-hidden">{t("untrusted.invisible", { count: hidden })}</span> : null}
      </p>
      <div className="uf-body">
        {segments.map((s, i) =>
          s.kind === "text" ? (
            <span key={i}>{s.text}</span>
          ) : (
            <span key={i} className="uf-cp">
              {s.code}
            </span>
          )
        )}
      </div>
    </div>
  );
}
