"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import type { Gig } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { clientAsksOf, clientMessageOf } from "../../logic/proposal";
import type { AfterWrite } from "../../logic/wire";
import { BidAsks } from "../report/BidAsks";
import { Panel } from "./Panel";
import { useResearch } from "./useResearch";

// The Review tab's right half: the first message to the client of a freelance gig, as the
// research brief wrote it (`outreachMessage`, prompt gig-brief-v4) - interest in the
// project, one line on the approach, and the artifacts the work needs that the listing does
// not provide (`missingArtifacts`, listed under it). Set as a message card to copy and paste:
// kp never sends it; the operator does, from their own account. A brief written before v4
// has none, and Research again writes one. Once the gig's client proposal is written, its bid
// message and its asks (the questions and the artifacts, logic/proposal.ts) replace the
// brief's, and the sub line says which one is shown and when it was written.

export function OutreachCard({ gig, onChanged }: { gig: Gig; onChanged: AfterWrite }) {
  const t = useTranslations("gigs.outreach");
  const tb = useTranslations("gigs.brief");
  const tp = useTranslations("gigs.proposal.review");
  const fmt = useGigsFormat();
  const research = useResearch(gig, onChanged);
  // The brief the research hook holds is the freshest (Research again rewrites it here).
  const current = { proposal: gig.proposal, brief: research.brief };
  const said = clientMessageOf(current);
  const message = said?.text ?? null;
  const asks = clientAsksOf(current);
  const artifacts = asks.artifacts;
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      // No clipboard access (an insecure origin, a denied permission): say so; the text stays selectable.
      setCopied("failed");
    }
  }

  const copyButton = message ? <Button label={copied === "yes" ? t("copied") : t("copy")} size="sm" variant={copied === "yes" ? "affirm" : "secondary"} onClick={() => void copy(message)} /> : null;

  return (
    <Panel title={t("title")} sub={!said ? undefined : said.from === "proposal" ? tp("fromProposal", { date: fmt.dateTime(said.at) }) : t("sub")} actions={copyButton}>
      <span className="sr-only" aria-live="polite">
        {copied === "yes" ? t("copied") : copied === "failed" ? t("copyFailed") : ""}
      </span>
      {message ? (
        <>
          <div className="msg-card">
            <p className="msg-to">{t("to", { client: gig.org ?? t("theClient") })}</p>
            <p className="msg-body">{message}</p>
          </div>
          {copied === "failed" ? <p className="t-meta coral">{t("copyFailed")}</p> : null}
          {asks.from === "proposal" ? (
            <div className="msg-asks">
              <BidAsks questions={asks.questions} artifacts={asks.artifacts} />
            </div>
          ) : artifacts.length ? (
            <section className="msg-asks" aria-label={t("asksFor")}>
              <h4 className="sub-title">
                {t("asksFor")} <span className="sub-n">{artifacts.length}</span>
              </h4>
              <ul>
                {artifacts.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="t-meta">{t("nothingMissing")}</p>
          )}
          <p className="t-meta msg-foot">{t("foot")}</p>
        </>
      ) : gig.arena === "freelance" ? (
        <div className="msg-none">
          <p className="panel-empty">{t("none")}</p>
          <Button label={tb("researchAgain")} loading={research.busy} loadingLabel={tb("researching")} size="sm" variant="secondary" onClick={() => void research.research()} />
          {research.error ? (
            <p role="alert" className="alert">
              {research.error}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="panel-empty">{t("notFreelance")}</p>
      )}
    </Panel>
  );
}
