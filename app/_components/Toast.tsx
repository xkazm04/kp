"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { getServerToasts, getToasts, subscribeToasts, toast, type ToastItem, type ToastVariant } from "./toast-store";

// The render half of the feedback layer (queue contract: toast-store.ts).
// Mounted ONCE in app/layout.tsx — inside NextIntlClientProvider, outside any
// route shell — so both the operator workspace and the public candidate token
// pages (/schedule/[token], /offer/[token], /login) share one stack.
//
// Portal to document.body, pinned TOP-RIGHT: the bottom edge belongs to the
// simulation SimBar (fixed inset-x-0 bottom-0 plus its collapsed pill at bottom
// center), so the stack stays clear of it. z-[var(--z-toast)] sits above the
// sim bar (55) and the Modal (50) — feedback about an action taken inside a
// dialog must not render underneath it.
//
// Theming rides the token seam: the card is a `shadow-panel` surface, which the
// [data-theme="dark"] ride in globals.css re-geometries into a Spark Dark
// sticker (drawn 2px outline, 16px radius, hard offset shadow); the alternating
// dark-only tilt gives the stack the landing's sticker-sheet character. Tone is
// carried by token borders/icons (moss = good, coral = alert, steel =
// commentary) following the app's existing status-surface vocabulary.
//
// A11y: errors are role="alert" (implicit assertive live region); success/info
// are role="status" aria-live="polite". Every card has a labelled dismiss
// button; hovering or focusing the stack pauses auto-dismiss (the full window
// restarts on leave).

// Hydration-safe client detection without an effect+setState (which lints as a
// cascading render): the server snapshot renders null, the first client
// snapshot flips to true and mounts the portal.
const emptySubscribe = () => () => {};

const TONE: Record<ToastVariant, { border: string; icon: typeof Info; iconColor: string }> = {
  success: { border: "border-moss/50", icon: CheckCircle2, iconColor: "text-moss" },
  error: { border: "border-coral/50", icon: AlertTriangle, iconColor: "text-coral" },
  info: { border: "border-stone-300", icon: Info, iconColor: "text-steel" },
};

function ToastCard({
  item,
  paused,
  reduced,
  dismissLabel,
}: {
  item: ToastItem;
  paused: boolean;
  reduced: boolean;
  dismissLabel: string;
}) {
  // Auto-dismiss. Keyed on `nonce` so a deduped re-fire restarts the window;
  // pause-on-hover clears the timer and restarts the full window on resume.
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => toast.dismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.id, item.duration, item.nonce, paused]);

  const tone = TONE[item.variant];
  const Icon = tone.icon;
  const isError = item.variant === "error";
  return (
    <motion.div
      layout={!reduced}
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={reduced ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, x: 24, transition: { duration: 0.15, ease: "easeOut" } }}
      transition={reduced ? { duration: 0.12 } : { type: "spring", stiffness: 420, damping: 34 }}
      role={isError ? "alert" : "status"}
      aria-live={isError ? undefined : "polite"}
      // Sticker-sheet in dark: shadow-panel picks up the globals.css re-geometry
      // ride; cards alternate a one-degree tilt like the landing's sticker pile.
      className={`pointer-events-auto flex w-full items-start gap-2.5 rounded-lg border bg-white p-3.5 shadow-panel ${tone.border} ${
        item.id % 2 === 0 ? "dark:rotate-1" : "dark:-rotate-1"
      }`}
    >
      <Icon size={16} className={`mt-0.5 shrink-0 ${tone.iconColor}`} aria-hidden />
      <p className="min-w-0 flex-1 text-sm font-medium text-ink">{item.message}</p>
      <button
        type="button"
        onClick={() => toast.dismiss(item.id)}
        aria-label={dismissLabel}
        className="focus-ring -m-1 shrink-0 rounded-md p-1 text-steel hover:bg-stone-100 hover:text-ink"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}

export function Toaster() {
  const t = useTranslations("common");
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  // Portal only on the client: SSR has no document.body and the queue is always
  // empty at hydration time, so the server/client first paint both render null.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  if (!mounted) return null;
  return createPortal(
    <div
      // top/right max() with the safe-area insets: keeps the stack out of the
      // Dynamic Island / notch in landscape (insets are 0 on desktop, so the
      // 1rem baseline is unchanged there).
      className="pointer-events-none fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-[var(--z-toast)] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      // React's synthesized enter/leave fires for the pointer-events-auto cards
      // inside this none-container, so hovering a toast pauses the whole stack.
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((item) => (
          <ToastCard key={item.id} item={item} paused={paused} reduced={reduced} dismissLabel={t("dismissNotification")} />
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
}
