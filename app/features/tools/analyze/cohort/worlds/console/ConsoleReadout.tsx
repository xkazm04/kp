"use client";

import type { CellTier, CohortDimension, CohortView } from "../../cohortTypes";
import { labelOf } from "./consoleModel";
import { busClaimWords, busSummary, stripFacts, type Fact } from "./ConsoleHeads";
import type { ConsoleWords } from "./useConsoleWords";

/** What the readout shows: a channel (scribble), a bus (its head), or one meter (both). */
export type Hot = { member: string | null; bus: CohortDimension | null } | null;

/**
 * The desk's readout: an LCD in the master section that reads whatever the reader points at or
 * focuses, in full: the untruncated name, the rating and its tier, the short label, the band and
 * what widened it, the reason a meter is capped, the rare comment, the decoy's reason, a bus's
 * claim. It repeats the focused part's accessible name visually, so it is `aria-hidden` (the
 * parts carry their own names) and nothing on the desk is hover-only.
 */
export function ConsoleReadout({ view, hot, covered, words }: { view: CohortView; hot: Hot; covered: ReadonlySet<string>; words: ConsoleWords }) {
  const m = hot?.member ? view.members.find((x) => x.memberId === hot.member) ?? null : null;
  const bus = hot?.bus ?? null;
  let title = "";
  let lines: Fact[] = [];

  if (m && bus) {
    const c = m.cells[bus];
    title = m.label;
    const rated = c.rating != null && c.tier !== "absent";
    lines.push({ k: "dim", text: rated ? `${words.dim(bus)} · ${c.rating} · ${words.tier(c.tier as Exclude<CellTier, "absent">)}` : `${words.dim(bus)} · ${words.absent(c.absentReason)}` });
    if (rated) lines.push({ k: "label", text: words.label(c.label) });
    if (c.band) {
      const drivers = c.band.drivers.map((d) => words.label(d)).join(", ");
      lines.push({ k: "band", text: [words.t("cell.band", { lo: c.band.lo, hi: c.band.hi }), drivers].filter(Boolean).join(" · "), tone: "quiet" });
    }
    if (c.comment) lines.push({ k: "note", text: c.comment, tone: "note" });
    if (bus !== "salary" && view.claims.byDimension[bus]?.leader === m.memberId && busClaimWords(view, bus, words).kind === "lead") {
      lines.push({ k: "lead", text: words.t("cell.lead") });
    }
    if (m.decoyOf) lines.push({ k: "decoy", text: words.t("decoy", { name: labelOf(view, m.decoyOf) ?? "—" }), tone: "warn" });
    lines.push({ k: "hint", text: words.t("master.readout.soloHint"), tone: "quiet" });
  } else if (m) {
    title = m.label;
    lines = stripFacts(view, m, words, covered.has(m.memberId));
    lines.push({ k: "hint", text: m.analysisSlug ? words.t("master.readout.openHint") : words.t("strip.noReport", { name: m.label }), tone: "quiet" });
  } else if (bus) {
    title = words.dim(bus);
    lines = [{ k: "sum", text: busSummary(view, bus, words) }];
    const claim = view.claims.byDimension[bus];
    if (claim?.partitions?.length) {
      lines.push({ k: "parts", text: words.t("bus.partitions", { n: claim.partitions.length, keys: claim.partitions.map((p) => `${p.key} (${p.memberIds.length})`).join(", ") }), tone: "warn" });
    }
    if (claim?.note) lines.push({ k: "note", text: claim.note, tone: "note" });
    lines.push({ k: "hint", text: words.t("master.readout.soloHint"), tone: "quiet" });
  }

  return (
    <div className="cx-readout" aria-hidden>
      <p className="cx-readout__label">{words.t("master.readout.label")}</p>
      {title ? (
        <>
          <p className="cx-readout__title">{title}</p>
          {lines.map((l) => (
            <p key={l.k} className="cx-readout__line" data-tone={l.tone}>
              {l.text}
            </p>
          ))}
        </>
      ) : (
        <p className="cx-readout__line" data-tone="quiet">
          {words.t("master.readout.idle")}
        </p>
      )}
    </div>
  );
}
