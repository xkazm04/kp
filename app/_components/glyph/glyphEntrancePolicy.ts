/** Whether a viewport re-entry should remount the entrance group.
 *
 *  Empty-state heroes persist; replaying the stagger on tab return is
 *  entrance-as-noise (surface doctrine §5). `playOnce` is the default.
 *  Under `prefers-reduced-motion` even a looping ambient consumer stays
 *  still — CSS already drops the animation, so remounting paths is churn
 *  with no visual benefit. */
export function shouldReplayEntrance({
  playOnce,
  reduced,
  reentered,
}: {
  playOnce: boolean;
  reduced: boolean;
  reentered: boolean;
}): boolean {
  if (playOnce || reduced) return false;
  return reentered;
}
