"use client";

import { IntakeAtelierDesk } from "./coats/atelier/IntakeAtelierDesk";
import type { useAppMasterLogic } from "./jdsIntakeAppMaster";
import type { IntakeLogic, IntakeSession } from "./jdsIntakeLogic";

// THE DESK — the studio's working surface.
//
// It was a coat host: one arm per direction (classic · atelier · console) behind
// a header switcher, so a reviewer could compare. The comparison is over. Atelier
// won — one continuous plane, record rows, gutter-marked turn blocks — with
// Console's Job-description sheet fused into `AtelierDraftSheet`, and both losing
// directions are deleted. There is one surface, and this is the name the overlay
// mounts it under.
//
// The structural point the desk was built for is unchanged: it does not pick its
// own height. In the old tab it was a block on a scrolling page and had to guess
// one (`clamp(28rem, 100dvh - 15rem, 48rem)` — a guess that had to leave room for
// a page it could not see). Here the container IS the height: the overlay's modal
// body, already bounded at 92dvh, so the desk fills it and the zones get the whole
// dialog.

export function IntakeStudioDesk(props: {
  active: IntakeSession;
  logic: IntakeLogic;
  appMaster: ReturnType<typeof useAppMasterLogic>;
}) {
  return <IntakeAtelierDesk {...props} />;
}
