"use client";

// The Docket's head: eyebrow, title and the headline sentence built from the live counts; the
// waiting numeral with its spine (one tile per person, grouped by role, coloured by what the AI
// proposes); then the tools: the role and governance-mode filters, select mode, the reconsider
// chip and Rules; and the legend that says what each mark and key means. Replaces the old
// DecisionsHeader. Honest by construction: "longest wait" is not shown (the queue carries no
// arrival time), a never-scored row and a no-proposal row each have their own mark.
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { Button } from "@/app/_components/kit/Button";
import { Mark } from "@/app/_components/kit/Mark";
import { PageHead } from "@/app/_components/kit/PageHead";
import { KeyHints } from "@/app/_components/kit/scene";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import { DecisionsExportLog } from "../DecisionsExportLog";
import { roleKeyOf } from "../decisionsQueueTypes";
import { proposalOf, type DocketGroup, type DocketHeadline } from "./docketModel";
import "./docket.css";

type EvalMode = "recommendation" | "committee" | "eligibility_list";

export function DocketHead({
  headline,
  groups,
  count,
  jobOptions,
  activeFilter,
  pending,
  setJobFilter,
  evalMode,
  setEvalMode,
  reconsiderCount,
  onRevealReconsider,
  onOpenRules,
  selectMode,
  canSelect,
  onToggleSelect,
}: {
  headline: DocketHeadline;
  groups: readonly DocketGroup[];
  /** The numeral: the filtered count when a role filter is on, else every pending entry. */
  count: number;
  jobOptions: { key: string; label: string }[];
  activeFilter: string | null;
  pending: Entry[];
  setJobFilter: (v: string | null) => void;
  evalMode: EvalMode;
  setEvalMode: (v: EvalMode) => void;
  reconsiderCount: number;
  onRevealReconsider: () => void;
  onOpenRules: () => void;
  selectMode: boolean;
  canSelect: boolean;
  onToggleSelect: () => void;
}) {
  const t = useTranslations("decisions");
  const enumLabel = useEnumLabel();
  const context = (
    <>
      {t("docket.headline", { waiting: headline.waiting, roles: headline.roles })}{" "}
      {headline.biggest ? <b>{t("docket.biggest", { role: headline.biggest.title, count: headline.biggest.count })}</b> : null}{" "}
      {headline.rejects > 0 ? (
        <>
          <span className="dk-irrev">{t("docket.rejectsLead", { count: headline.rejects })}</span> {t("docket.irreversible")}
        </>
      ) : (
        t("docket.noRejects")
      )}
    </>
  );

  return (
    <header>
      <div className="dk-head">
        <PageHead eyebrow={t("eyebrow")} title={t("title")} context={null} />
        <div className="dk-hero">
          <span className="dk-hero__n nums" aria-hidden>{count}</span>
          <span className="dk-hero__l">
            <b>{t("docket.heroLabel")}</b> · {t("docket.heroSplit", { proposed: headline.proposed, unproposed: headline.unproposed })}
          </span>
          <div className="dk-spine" role="group" aria-label={t("docket.spineLabel")}>
            {groups.map((g) => (
              <span key={g.key} className="dk-spine__g" role="img" aria-label={t("docket.spineGroup", { role: g.title, count: g.rows.length })}>
                {g.rows.map((r) => (
                  <i key={r.entry.id} className="dk-spine__t" data-p={proposalOf(r)} aria-hidden />
                ))}
              </span>
            ))}
          </div>
        </div>
        <p className="dk-headline">{context}</p>
      </div>

      <div className="dk-tools">
        {jobOptions.length > 1 ? (
          <Select
            ariaLabel={t("filterTitle")}
            value={activeFilter ?? ""}
            onChange={(v) => setJobFilter(v || null)}
            sizeVariant="sm"
            options={[
              { value: "", label: t("allRoles", { count: pending.length }) },
              ...jobOptions.map((o) => ({ value: o.key, label: `${o.label} (${pending.filter((e) => roleKeyOf(e) === o.key).length})` })),
            ]}
          />
        ) : null}
        <Select
          ariaLabel={t("govModeTitle")}
          value={evalMode}
          onChange={(v) => setEvalMode(v as EvalMode)}
          sizeVariant="sm"
          options={[
            { value: "recommendation", label: t("govRecommendation") },
            { value: "committee", label: t("govCommittee") },
            { value: "eligibility_list", label: t("govEligibility") },
          ]}
        />
        {canSelect || selectMode ? (
          <Button size="sm" variant={selectMode ? "primary" : "secondary"} label={selectMode ? t("batch.exit") : t("batch.select")} aria-pressed={selectMode} onClick={onToggleSelect} />
        ) : null}
        <span className="dk-tools__sp" />
        {/* reconsider-earns-keep: the auto-reject safety valve as a headline count, so an audit isn't
            buried in a collapsed section at the bottom. Opens and scrolls to the reconsider queue. */}
        {reconsiderCount > 0 ? (
          <Button size="sm" variant="secondary" icon="resend" label={t("reconsiderChip", { count: reconsiderCount })} onClick={onRevealReconsider} />
        ) : null}
        {/* The decision trail as a file, from the same builder the Analytics log exports —
            an audit artifact belongs beside the queue that produces it, not only two tabs away. */}
        <DecisionsExportLog />
        <Button size="sm" variant="secondary" label={t("rulesButton")} tip={t("rulesTitle")} onClick={onOpenRules} />
      </div>

      <div className="dk-legend">
        <span><Mark kind="ok" /> {enumLabel("recommendation", "advance")}</span>
        <span><Mark kind="wait" /> {enumLabel("recommendation", "hold")}</span>
        <span><Mark kind="fail" /> {enumLabel("recommendation", "reject")}</span>
        <span><Mark kind="unknown" hollow /> {t("docket.legendNone")}</span>
        <span><Mark kind="caution" /> {t("docket.legendStale")}</span>
        <span>{t("docket.legendNever")}</span>
        <KeyHints
          label={t("docket.keysLabel")}
          hints={[
            { id: "move", keys: ["Tab"], act: t("docket.keyMove") },
            { id: "open", keys: ["Enter"], act: t("docket.keyOpen") },
            { id: "back", keys: ["Esc"], act: t("docket.keyBack") },
          ]}
        />
      </div>
    </header>
  );
}

