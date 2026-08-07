"use client";

import { useTranslations } from "next-intl";
import { BookedCard } from "./BookedCard";
import { DeadLinkCard } from "./DeadLinkCard";
import { ProposeSection } from "./ProposeSection";
import { SlotPicker } from "./SlotPicker";
import { useScheduleInvite } from "./use-schedule-invite";

/**
 * The candidate's self-scheduling surface. This component owns ONLY the order in
 * which the states win — that ordering is the logic: a load error hides everything,
 * an unloaded invite shows the spinner copy, a dead link beats a booking, and a
 * booking beats the picker unless the candidate opted into rescheduling. State,
 * fetching and mutations live in useScheduleInvite; each state renders as its own
 * presentational component.
 */
export function SchedulePicker({ token }: { token: string }) {
  const tCommon = useTranslations("common");
  const s = useScheduleInvite(token);

  // The escalation surface, shared by the two stuck states (a fully-booked horizon
  // and the reschedule cap); each host decides whether to render it.
  const proposeSection = (
    <ProposeSection
      proposalStatus={s.proposalStatus}
      proposeTimes={s.proposeTimes}
      proposing={s.proposing}
      onChangeTime={s.setProposeTime}
      onSubmit={s.submitProposals}
    />
  );

  if (s.error)
    return (
      <p role="alert" className="rounded-md border border-stone-200 bg-paper p-4 text-base text-coral">
        {s.error}
      </p>
    );
  if (!s.invite) return <p className="text-base text-steel">{tCommon("loading")}</p>;

  if (s.closedReason) {
    return <DeadLinkCard closedReason={s.closedReason} />;
  }

  if (s.confirmed && !s.rescheduling) {
    return (
      <BookedCard
        invite={s.invite}
        token={token}
        confirmed={s.confirmed}
        confirmationDelivery={s.confirmationDelivery}
        canReschedule={s.canReschedule}
        capReached={s.capReached}
        rsvpPending={s.rsvpPending}
        onReschedule={s.startReschedule}
        onRsvp={s.rsvp}
        onWithdraw={s.withdraw}
        proposeSection={proposeSection}
      />
    );
  }

  return (
    <SlotPicker
      invite={s.invite}
      slots={s.slots}
      noSlots={s.noSlots}
      calendarChecked={s.calendarChecked}
      notice={s.notice}
      rescheduling={s.rescheduling}
      confirmed={s.confirmed}
      picking={s.picking}
      onPick={s.pick}
      onKeepCurrentTime={s.keepCurrentTime}
      proposeSection={proposeSection}
    />
  );
}
