"use client";

// letters — the outreach letters WAITING FOR APPROVAL (round 4), read from the one new door
// GET /api/outreach-letters?state=drafted (oldest first, no body). Rows are candidates
// (selectable — the email tool opens the letter), grouped by role. A row's quiet act (or its
// `a` key) arms an "approve this revision" consent card; only its press writes.
// Only first-contact outreach is held today, so this view never fakes another letter kind.
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { ConsoleLink } from "./PanelShell";
import { NameCell, PanelFrame, type InsightData } from "./PanelFrame";
import { rowLimit } from "./cells";
import { useLettersWaiting, type LetterItem } from "../tools/reads";
import type { PanelProps } from "./types";

const actParams = (l: LetterItem) => ({ entryId: l.entryId, letterId: l.id, revision: String(l.revision), label: l.candidateLabel });

export function LettersPanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const tl = useTranslations("one.core.panels.letters");
  const fmt = useDateFormat();
  const read = useLettersWaiting(props.epoch);
  const data = read.state === "ready" ? read.data : null;
  const all = data?.letters ?? [];
  const limit = rowLimit(props.look);

  const insight = ((): InsightData | undefined => {
    if (props.look !== "insight" || !data) return undefined;
    const perRole = new Map<string, number>();
    for (const l of all) perRole.set(l.jobTitle ?? t("group.none"), (perRole.get(l.jobTitle ?? t("group.none")) ?? 0) + 1);
    const parts = [...perRole.entries()].sort((a, b) => b[1] - a[1]);
    const oldest = all[0];
    return {
      shape: {
        label: tl("perRole"),
        parts: [
          ...parts.slice(0, 4).map(([k, v]) => ({ key: k, label: k, value: v })),
          ...(parts.length > 4 ? [{ key: "other", label: t("insight.other"), value: parts.slice(4).reduce((n, [, v]) => n + v, 0) }] : []),
        ],
      },
      facts: oldest
        ? [{ key: "oldest", label: tl("oldest"), value: oldest.candidateLabel, sub: tl("since", { date: fmt.date(oldest.createdAt) }), mark: "needs" as const }]
        : [],
      // The one suggestion is a READ, not a write: open the oldest letter in the email tool.
      suggest:
        oldest && props.onSelectEntry
          ? { label: tl("open", { label: oldest.candidateLabel }), hint: oldest.subject ?? tl("noSubject"), onPress: () => props.onSelectEntry?.({ entryId: oldest.entryId, label: oldest.candidateLabel }) }
          : undefined,
    };
  })();

  return (
    <PanelFrame
      props={props}
      data={{
        title: tl("title"),
        count: data ? all.length : null,
        console: { tab: "pipeline" },
        read,
        cols: [
          { key: "name", label: t("cols.candidate"), track: "minmax(9rem,1fr)" },
          { key: "rev", label: t("cols.revision"), track: "5rem", end: true },
          { key: "at", label: t("cols.drafted"), track: "7rem", end: true },
        ],
        // The ✓ AND the Console door share this track: 9rem holds both without spilling
        // over the drafted date.
        actsTrack: "9rem",
        keyHint: tl("keys"),
        rows: all.slice(0, limit).map((l) => {
          const approve = () => props.onPropose("letterApprove", actParams(l));
          return {
            key: l.id,
            cells: {
              name: <NameCell name={l.candidateLabel} sub={l.subject ?? tl("noSubject")} />,
              rev: <span className="k-nums">{l.revision}</span>,
              at: <span className="k-nums">{fmt.date(l.createdAt)}</span>,
            },
            line: l.candidateLabel,
            meta: [l.subject ?? tl("noSubject"), fmt.date(l.createdAt)].join(" · "),
            entry: { entryId: l.entryId, label: l.candidateLabel },
            group: { key: l.jobTitle ?? "", label: l.jobTitle ?? t("group.none") },
            keys: { a: approve },
            acts: (
              <Button label={tl("approveWho", { label: l.candidateLabel })} icon="check" iconOnly variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); approve(); }} data-act="letter-approve" />
            ),
            door: <ConsoleLink tab="pipeline" params={{ q: l.candidateLabel }} />,
          };
        }),
        insight,
        empty: tl("empty"),
        foot: [all.length > limit ? t("firstOf", { shown: limit, total: all.length }) : null, data?.truncated ? tl("truncated") : null].filter(Boolean).join(" ") || undefined,
      }}
    />
  );
}
