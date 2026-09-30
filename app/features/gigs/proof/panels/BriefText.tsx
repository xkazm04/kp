"use client";

import { Markdown } from "@/app/_components/Markdown";
import { Tag } from "@/app/_components/kit";
import type { GigBrief } from "@/app/_lib/gigs/types";
import { briefChallenges, GIG_BRIEF_CHALLENGES_HEADING } from "@/app/_lib/gigs/withdraw-reasons";
import { briefHeadingResolver } from "../../logic/brief";
import { briefBody } from "../../logic/briefBody";
import { BriefChallenges, type ChallengeWithdraw } from "./BriefChallenges";

// The brief's reading column: the categories, the categorized title as the heading, then the
// Markdown body (the safe renderer) with "Expected challenges" set as rows with Withdraw for
// this (BriefChallenges.tsx) and "Sources read" left to the sidebar's list (BriefAside.tsx).
// The Summary sets it twice (summary/GigSummary.tsx): on the Brief tab with its title, and in
// the Summary's Brief panel without it (the panel's heading and the header carry it).

export function BriefText({ brief, withdraw, title = true }: { brief: GigBrief; withdraw: ChallengeWithdraw; title?: boolean }) {
  const challenges = briefChallenges(brief);
  const cut = briefBody(brief.markdown, brief.sections, GIG_BRIEF_CHALLENGES_HEADING, challenges.length > 0);
  const resolve = briefHeadingResolver(brief.sections);
  return (
    <>
      {title ? (
        <>
          <div className="brief-cats">
            {brief.category
              .split(/\s*·\s*/)
              .filter(Boolean)
              .map((c) => (
                <Tag key={c} label={c} />
              ))}
          </div>
          <h3 className="brief-title">{brief.title}</h3>
        </>
      ) : null}
      {cut.body.trim() ? <Markdown content={cut.body} headingId={resolve} className="md-body brief-body" /> : null}
      {cut.challenges ? <BriefChallenges id={cut.challenges.id} heading={cut.challenges.text} challenges={challenges} withdraw={withdraw} /> : null}
      {cut.after.trim() ? <Markdown content={cut.after} headingId={resolve} className="md-body brief-body" /> : null}
    </>
  );
}
