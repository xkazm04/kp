"use client";

import { useTranslations } from "next-intl";
import { Mark, Tag } from "@/app/_components/kit";
import type { Gig } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import type { SourceRow } from "../../logic/wire";
import { UntrustedText } from "../../shared/UntrustedText";
import { Panel } from "./Panel";

// The listing: a stranger's text, framed as untrusted, its invisible characters shown, the
// suspect reasons explained. A suspect listing's URL stays text.

export function ListingPanel({ gig, source }: { gig: Gig; source: SourceRow | null }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const suspect = gig.status === "suspect" || gig.suspectReasons.length > 0;
  return (
    <Panel
      title={t("back.listing")}
      sub={[gig.org, source?.host ?? t("facts.forwarded")].filter(Boolean).join(" · ")}
      actions={
        suspect ? null : (
          <a className="k-btn k-btn--secondary k-btn--sm" href={gig.url} target="_blank" rel="noopener noreferrer">
            {t("back.original")}
          </a>
        )
      }
    >
      {gig.suspectReasons.length ? (
        <ul className="flags">
          {gig.suspectReasons.map((r) => (
            <li key={r}>
              <Mark kind="fail" tip={t("suspectView.why")} />
              <span>
                <b>{fmt.suspect(r)}.</b> {t(`suspectWhy.${r}` as never)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <UntrustedText gig={gig} source={source} />
      <div className="listing-foot">
        {gig.tags.length ? (
          <div className="tag-row">
            {gig.tags.map((x) => (
              <Tag key={x} label={x} />
            ))}
          </div>
        ) : null}
        {suspect ? <p className="t-meta anywhere">{t("suspectView.urlAsText", { url: gig.url })}</p> : null}
      </div>
    </Panel>
  );
}
