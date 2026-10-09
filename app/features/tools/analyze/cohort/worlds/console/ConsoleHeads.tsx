"use client";

import { ScenePress } from "@/app/_components/kit/scene";
import type { CohortDimension, CohortMember, CohortView } from "../../cohortTypes";
import { absentTally, busClaim, labelOf, stripState, trustLamps, type BusClaim } from "./consoleModel";
import type { DeskPress } from "./ConsoleCells";
import type { ConsoleWords } from "./useConsoleWords";

/** The words a strip's tape carries on its second line: the run state while it is not live, else membership. */
function tapeLine(m: CohortMember, words: ConsoleWords): string {
  const s = stripState(m);
  if (s === "failed") return words.t("strip.run.failed");
  if (s === "pending") return words.t(m.runState === "analyzing" ? "strip.run.analyzing" : "strip.run.queued");
  return words.t(`strip.tape.${m.membership}`);
}

export type Fact = { k: string; text: string; tone?: "note" | "warn" | "quiet" };

/** What a channel's scribble strip and lamps say, fact by fact (the readout lists them; the strip joins them). */
export function stripFacts(view: CohortView, m: CohortMember, words: ConsoleWords, covered: boolean): Fact[] {
  const lamps = trustLamps(m);
  const facts: Array<Fact | null> = [
    { k: "member", text: words.t(`strip.membership.${m.membership}`) },
    { k: "run", text: words.t(`strip.run.${m.runState}`) },
    lamps == null ? { k: "unread", text: words.t("strip.lamps.unread"), tone: "quiet" } : null,
    lamps?.peak ? { k: "peak", text: words.t("strip.lamps.peak"), tone: "warn" } : null,
    lamps?.clip ? { k: "clip", text: words.t("strip.lamps.clip"), tone: "warn" } : null,
    covered ? { k: "talkback", text: words.t("strip.lamps.talkback") } : null,
    m.decoyOf ? { k: "decoy", text: words.t("decoy", { name: labelOf(view, m.decoyOf) ?? "—" }), tone: "warn" } : null,
  ];
  return facts.filter((f): f is Fact => f !== null);
}

/** Everything the scribble strip says, as one accessible name (the readout repeats it on focus). */
export function stripName(view: CohortView, m: CohortMember, words: ConsoleWords, covered: boolean): string {
  const head = [words.t("strip.channel", { n: m.neutralIndex + 1 }), m.label];
  return [...head, ...stripFacts(view, m, words, covered).map((f) => f.text)].join(". ");
}

/**
 * A channel's scribble strip: its number, the lamps (trust peak and clip, the talkback lamp of the
 * narrative, Ø when the channel is phase-cancelled) and the tape, written up the strip: the name,
 * then the run state while it is not live, else how it joined. Pressing it opens the full report
 * once the analysis has landed.
 */
export function ConsoleScribble({ view, member, words, covered, press, onOpenReport }: {
  view: CohortView;
  member: CohortMember;
  words: ConsoleWords;
  covered: boolean;
  press: DeskPress;
  onOpenReport: (slug: string) => void;
}) {
  const lamps = trustLamps(member);
  const slug = member.analysisSlug;
  const name = stripName(view, member, words, covered);
  return (
    <ScenePress
      {...press}
      className="cx-scribble"
      data-state={stripState(member)}
      data-membership={member.membership}
      data-decoy={member.decoyOf ? "" : undefined}
      aria-label={`${name}. ${slug ? words.t("strip.open", { name: member.label }) : words.t("strip.noReport", { name: member.label })}`}
      aria-disabled={slug ? undefined : true}
      onClick={() => slug && onOpenReport(slug)}
    >
      <span className="cx-chan k-nums" aria-hidden>
        {member.neutralIndex + 1}
        {member.decoyOf ? <b className="cx-phase">Ø</b> : null}
      </span>
      <span className="cx-lamps" aria-hidden>
        <i className="cx-lamp" data-lamp="peak" data-on={lamps?.peak || undefined} data-unread={lamps == null || undefined} />
        <i className="cx-lamp" data-lamp="clip" data-on={lamps?.clip || undefined} data-unread={lamps == null || undefined} />
        <i className="cx-lamp" data-lamp="talkback" data-on={covered || undefined} />
      </span>
      <span className="cx-tape" aria-hidden>
        <span className="cx-tape__name">{member.label}</span>
        <span className="cx-tape__line">{tapeLine(member, words)}</span>
      </span>
    </ScenePress>
  );
}

/** The claim word a bus head prints, and the long one the readout and the solo kicker read. */
export function busClaimWords(view: CohortView, dim: CohortDimension, words: ConsoleWords): { short: string; long: string; kind: BusClaim["kind"] } {
  const c = busClaim(view, dim);
  if (c.kind === "lead") {
    const name = labelOf(view, c.leader) ?? "—";
    return { kind: c.kind, short: words.t("bus.claim.lead", { name }), long: words.t("bus.claimLong.lead", { name }) };
  }
  return { kind: c.kind, short: words.t(`bus.claim.${c.kind}`), long: words.t(`bus.claimLong.${c.kind}`) };
}

/** Everything a bus head says, as one string: the claim, how many are rated, why the rest are not. */
export function busSummary(view: CohortView, dim: CohortDimension, words: ConsoleWords): string {
  const claim = busClaimWords(view, dim, words);
  const c = view.claims.byDimension[dim];
  const absent = absentTally(view, dim).map((r) => `${r.n} × ${words.absent(r.reason)}`);
  return [claim.long, words.t("bus.rated", { rated: c?.rated ?? 0, total: view.members.length }), absent.join(", ")].filter(Boolean).join(" ");
}

/**
 * A bus's head at the left of its row: the dimension's name, its SOLO key (descends into the
 * dimension's page), the claim lamp and word (lit only for a lead that clears; hazy for "within the
 * noise"; dark for no comparison; a steel bar for salary, which is never ranked).
 */
export function ConsoleBusHead({ view, dim, words, soloed, press, onSolo }: {
  view: CohortView;
  dim: CohortDimension;
  words: ConsoleWords;
  soloed: boolean;
  press: DeskPress;
  onSolo: (el: HTMLElement) => void;
}) {
  const claim = busClaimWords(view, dim, words);
  return (
    <span className="cx-bushead" data-claim={claim.kind}>
      <span className="cx-bushead__name">{words.dim(dim)}</span>
      <ScenePress
        {...press}
        className="cx-solo"
        data-solo-key={dim}
        data-on={soloed || undefined}
        aria-label={`${words.t("bus.soloLabel", { dim: words.dim(dim) })}. ${busSummary(view, dim, words)}`}
        onClick={(e) => onSolo(e.currentTarget)}
      >
        {words.t("bus.solo")}
      </ScenePress>
      <span className="cx-bushead__claim" aria-hidden>
        <i className="cx-claimlamp" />
        <span>{claim.short}</span>
      </span>
    </span>
  );
}
