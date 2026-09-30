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
// The Brief tab's panel and the Summary prototypes (report/variants/) both set it; the
// Summary may drop the title and the first section when its hero already carries them.

export function BriefText({ brief, withdraw, title = true, dropFirst = false }: { brief: GigBrief; withdraw: ChallengeWithdraw; title?: boolean; dropFirst?: boolean }) {
  const challenges = briefChallenges(brief);
  const cut = briefBody(brief.markdown, brief.sections, GIG_BRIEF_CHALLENGES_HEADING, challenges.length > 0, dropFirst);
  const resolve = briefHeadingResolver(brief.sections);
  // Heading ids are positional: a dropped first section shifts every heading by one.
  const headingId = dropFirst ? (h: Parameters<typeof resolve>[0]) => resolve({ ...h, index: h.index + 1 }) : resolve;
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
      {cut.body.trim() ? <Markdown content={cut.body} headingId={headingId} className="md-body brief-body" /> : null}
      {cut.challenges ? <BriefChallenges id={cut.challenges.id} heading={cut.challenges.text} challenges={challenges} withdraw={withdraw} /> : null}
      {cut.after.trim() ? <Markdown content={cut.after} headingId={resolve} className="md-body brief-body" /> : null}
    </>
  );
}
