/** Whether a viewport re-entry should remount the entrance group.
 *
 *  Empty-state heroes persist; replaying the stagger on tab return is
 *  entrance-as-noise (surface doctrine §5). `playOnce` is the default. */
export function shouldReplayEntrance({
  playOnce,
  reentered,
}: {
  playOnce: boolean;
  reentered: boolean;
}): boolean {
  if (playOnce) return false;
  return reentered;
}
