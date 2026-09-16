"use client";

// The candidate MODAL — the one place a pipeline candidate is read and acted on. It
// replaced the right-side candidate drawer (and the map's view-only detail modal):
// a bead, an Orchard ticket, a degraded-intake chip, a rematch link and the profile
// fallback all open THIS, on the tab that suits the door.
//
// Shape follows the viewport: a centred, wide dialog from `sm` up, a bottom sheet
// on a phone. Portalled to <body> so no board wrapper's transform can become its
// containing block, at z-50 like the shared Modal — later portals paint on top, so
// it sits over the Orchard it was opened from and under the transcript modal it
// opens.
//
// This file is the FRAME: portal, scrim, motion and the dialog behaviour
// (useDialogA11y). Everything about the candidate lives in CandidateModalBody,
// keyed by entry id so a prev/next step resets per-entry state while the frame,
// its focus trap and its animation stay put.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { CandidateModalBody } from "./CandidateModalBody";
import type { CandidateTab, CandidateView } from "./candidateView";

const EASE = [0.16, 1, 0.3, 1] as const;
const TITLE_ID = "candidate-modal-title";
const noSubscription = () => () => undefined;

export type CandidateModalProps = {
  view: CandidateView;
  /** The board's visible order — the cohort when the view carries none. */
  boardCohort: readonly Entry[];
  axis: readonly StageDef[];
  onClose: () => void;
  /** Reload the board behind the modal. */
  onChanged: () => void;
  /** Open (or refresh in place) an entry by id — rematch links, stage moves. */
  onOpenEntry: (entryId: string) => void;
  onNavigate: (entry: Entry) => void;
  onTab: (tab: CandidateTab) => void;
};

export function CandidateModal(props: CandidateModalProps) {
  const { view, onClose } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  // The hydration-safe read of document.body (null on the server snapshot).
  const portalRoot = useSyncExternalStore(noSubscription, () => document.body, () => null);
  useDialogA11y(ref, onClose, { trap: true, lockScroll: true });
  // A prev/next step remounts the body, and with it the pager button that had focus;
  // hand focus back to the dialog so the Tab trap never starts from <body>.
  useEffect(() => {
    const node = ref.current;
    if (node && !node.contains(document.activeElement)) node.focus();
  }, [view.entry.id]);

  if (!portalRoot) return null;
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: 24 };
  return createPortal(
    <>
      <motion.div
        className="fixed inset-0 z-50 bg-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.2, ease: "linear" }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* The positioning layer ignores the pointer, so a click beside the dialog
          lands on the scrim and closes, like every other modal here. */}
      <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
        <motion.div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          tabIndex={-1}
          className="pointer-events-auto flex max-h-[92dvh] w-full max-w-[1000px] flex-col overflow-hidden rounded-t-2xl border border-stone-200 bg-paper shadow-overlay focus:outline-none sm:max-h-full sm:rounded-xl"
          initial={hidden}
          animate={{ opacity: 1, y: 0 }}
          exit={hidden}
          transition={{ duration: reduced ? 0 : 0.24, ease: EASE }}
        >
          <CandidateModalBody key={view.entry.id} {...props} titleId={TITLE_ID} />
        </motion.div>
      </div>
    </>,
    portalRoot,
  );
}
