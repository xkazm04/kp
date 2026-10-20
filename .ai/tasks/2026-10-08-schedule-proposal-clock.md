# Schedule proposal clock (candidate-self-scheduling lite r1, value-1)

Must-address: "A candidate who proposes their own times from a pending invite is still on the 7-day link clock".

- `scheduleInviteExpiryAnchor` (app/_lib/schedule-slots.ts) is the one anchor: newest of created_at, cancel-reopen stamp, proposals_at (pending or declined).
- `declineScheduleInviteProposals` keeps proposals_at so a decline does not snap the anchor back to the mint. No new status/column.
- candidate-next-action and candidate-timeline use the shared anchor.
- Left alone: the recruiter gets no outward notice of a proposal; the reminder sweep is untouched.
