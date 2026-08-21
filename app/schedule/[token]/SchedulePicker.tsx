"use client";

import { useTranslations } from "next-intl";
import { BookedCard } from "./BookedCard";
import { DeadLinkCard } from "./DeadLinkCard";
import { ProposeSection } from "./ProposeSection";
import { SlotPicker } from "./SlotPicker";
import { useScheduleInvite } from "./use-schedule-invite";

/** The one error surface, shared by the fatal and the transient case below. */
const ERROR_NOTE = "rounded-md border border-stone-200 bg-paper p-4 text-base text-coral";

/**
 * The candidate's self-scheduling surface. This component owns ONLY the order in
 * which the states win — that ordering is the logic: an unloaded invite shows the
 * spinner copy (or, when the load itself failed, the error alone), a dead link beats
 * a booking, and a booking beats the picker unless the candidate opted into
 * rescheduling. An ACTION error rides ABOVE whichever of those won, never instead of
 * it. State, fetching and mutations live in useScheduleInvite; each state renders as
 * its own presentational component.
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

  // `error` carries BOTH a fatal LOAD failure and a transient ACTION failure (a 409
  // "that time was just taken", an empty propose batch). Returning early on it treated
  // the two alike, so an action error REPLACED the whole surface with the very
  // instruction the candidate could no longer act on — "please pick another" with no
  // list, "please add at least one time" with no form — recoverable only by reloading.
  // A load failure leaves no invite to render, so it still owns the surface below;
  // everything else renders as a banner above the live state, and every action clears
  // it on its next attempt.
  if (!s.invite)
    return s.error ? (
      <p role="alert" className={ERROR_NOTE}>
        {s.error}
      </p>
    ) : (
      <p className="text-base text-steel">{tCommon("loading")}</p>
    );

  const errorBanner = s.error ? (
    <p role="alert" className={`mb-3 ${ERROR_NOTE}`}>
      {s.error}
    </p>
  ) : null;

  // A dead link beats a stale error: there is no action left to retry on it.
  if (s.closedReason) {
    return <DeadLinkCard closedReason={s.closedReason} />;
  }

  if (s.confirmed && !s.rescheduling) {
    return (
      <>
        {errorBanner}
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
      </>
    );
  }

  return (
    <>
      {errorBanner}
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
    </>
  );
}
