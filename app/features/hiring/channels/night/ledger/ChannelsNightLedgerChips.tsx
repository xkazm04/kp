"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ABSENT, ChipRow, Mark, type Chip } from "@/app/_components/kit";
import { commsStatusLabels } from "../../channelsCommsHelpers";
import { LEDGER_CHIPS, VERDICT_MARK, chipReading, type LedgerChip, type VerdictFilter } from "./channelsNightLedgerModel";

/**
 * The seven verdict chips, needs-you first (keys 1-7, in this order). Each count is over what the
 * OTHER filters keep; a chip with 0 is disabled, never hidden (unless it is the one pressed: a
 * filter must always be undoable). A zero only a relay could have filled, while the relay is
 * known to be off, reads "—" with its reason (chipReading): "0 failed" with nothing sent is not
 * good news. When older rows exist beyond the loaded pages, the counts say whose they are.
 */
export function ChannelsNightLedgerChips({ counts, verdict, relayConfigured, olderExist, loaded, onToggle }: {
  counts: Record<LedgerChip, number>;
  verdict: VerdictFilter;
  relayConfigured: boolean;
  olderExist: boolean;
  loaded: number;
  onToggle: (chip: LedgerChip) => void;
}) {
  const tc = useTranslations("channels.comms");
  const tl = useTranslations("channelsNight.ledger");
  const labels = useMemo(() => ({ ...commsStatusLabels(tc), dead: tl("needsYou") }), [tc, tl]);
  let dashed = false;
  const chips: Chip[] = LEDGER_CHIPS.map((chip) => {
    const reading = chipReading(chip, counts[chip], relayConfigured);
    dashed ||= reading.notMeasured;
    const pressed = verdict === chip;
    return {
      id: chip,
      label: reading.notMeasured ? `${labels[chip]} ${ABSENT}` : labels[chip],
      count: reading.count ?? undefined,
      mark: <span aria-hidden="true"><Mark kind={chip === "dead" ? "needs" : VERDICT_MARK[chip]} /></span>,
      pressed,
      disabled: !pressed && !reading.count,
      tip: reading.notMeasured ? tl("notMeasuredTip") : undefined,
      onPress: () => onToggle(chip),
    };
  });
  return (
    <div className="cn-ledger__chips">
      <div role="group" aria-label={tl("chipsLabel")}>
        <ChipRow chips={chips} />
      </div>
      {dashed || olderExist ? (
        <p className="cn-ledger__aside">
          {dashed ? tl("notMeasuredNote") : null}
          {dashed && olderExist ? " " : null}
          {olderExist ? tc("olderExist", { count: loaded }) : null}
        </p>
      ) : null}
    </div>
  );
}
