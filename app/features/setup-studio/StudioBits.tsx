"use client";

/*
 * The studio's small shared parts: the probe glyph, the connection chip, the
 * appearance toggle and a two-marker prose renderer.
 *
 * They live together because each is a handful of lines and all four are used by
 * three or more of the panels; a file each would be filing, not structure.
 */

import { Fragment, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Moon, Sun, XCircle, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { useTheme } from "@/app/_components/ui/useTheme";
import { setTheme, type Theme } from "@/app/_lib/theme";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { TOGGLE_GROUP } from "@/app/_components/ui/recipes";
import type { ProbeStatus } from "./protocol";
import type { ConnectionState } from "./useWizardSession";
import { COPY } from "./copy";

/* ── probe status ───────────────────────────────────────────────────────── */

/** One vocabulary for a probe's four states — icon, tone and colour together, so
 *  the live list, the collapsed strip and the "all details" list cannot drift. */
const PROBE_LOOK: Record<ProbeStatus, { icon: LucideIcon; className: string; tone: BadgeTone }> = {
  ok: { icon: CheckCircle2, className: "text-score-strong", tone: "positive" },
  warn: { icon: AlertTriangle, className: "text-score-mid", tone: "caution" },
  fail: { icon: XCircle, className: "text-score-weak", tone: "critical" },
  running: { icon: Loader2, className: "text-steel", tone: "neutral" },
};

export function ProbeGlyph({ status }: { status: ProbeStatus }) {
  const look = PROBE_LOOK[status];
  const Icon = look.icon;
  return (
    <Icon
      size={16}
      aria-hidden
      // The spinner is the ONE looping animation on this page, so it carries its
      // own reduced-motion gate rather than borrowing a shared one.
      className={`shrink-0 ${look.className} ${status === "running" ? "animate-spin motion-reduce:animate-none" : ""}`}
    />
  );
}

export function probeTone(status: ProbeStatus): BadgeTone {
  return PROBE_LOOK[status].tone;
}

/* ── connection ─────────────────────────────────────────────────────────── */

const CONNECTION_LOOK: Record<ConnectionState, { label: string; tone: BadgeTone; dot: boolean }> = {
  idle: { label: COPY.connConnecting, tone: "neutral", dot: false },
  connecting: { label: COPY.connConnecting, tone: "neutral", dot: true },
  open: { label: COPY.connOpen, tone: "positive", dot: true },
  retrying: { label: COPY.connRetrying, tone: "caution", dot: true },
  lost: { label: COPY.connLost, tone: "critical", dot: false },
};

/** The link to the installer is part of the UI, not a hidden assumption: an SSE
 *  stream that is silently retrying looks exactly like a run that is thinking. */
export function ConnectionChip({ state }: { state: ConnectionState }) {
  const look = CONNECTION_LOOK[state];
  return <Badge tone={look.tone} dot={look.dot} label={look.label} />;
}

/* ── appearance ─────────────────────────────────────────────────────────── */

const THEMES: readonly { id: Theme; icon: LucideIcon; label: string }[] = [
  { id: "light", icon: Sun, label: "Studio Light" },
  { id: "dark", icon: Moon, label: "Spark Dark" },
];

/**
 * The studio's own appearance control.
 *
 * Same plumbing as the sidebar rail's (`setTheme` flips `data-theme` on `<html>`,
 * `useTheme` subscribes to it) — but this page has no rail, and importing one to
 * borrow two buttons would drag the whole workspace shell onto a surface that is
 * deliberately outside it. The mechanism is shared; the control is local.
 */
export function AppearanceToggle() {
  const theme = useTheme();
  const reduced = useReducedMotion();
  return (
    <div className={TOGGLE_GROUP} role="group" aria-label="Appearance">
      {THEMES.map((option) => {
        const Icon = option.icon;
        const active = theme === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            title={option.label}
            onClick={() => setTheme(option.id)}
            className={`focus-ring relative grid h-7 w-8 place-items-center rounded-md transition-colors ${
              active ? "text-white" : "text-steel hover:text-ink"
            }`}
          >
            {active ? (
              <motion.span
                layoutId="studio-theme-pill"
                className="absolute inset-0 z-0 rounded-md bg-ink"
                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
            <Icon size={14} aria-hidden className="relative z-10" />
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── prose ──────────────────────────────────────────────────────────────── */

/*
 * The agent's narration and the matrix's cells are markdown, but only two
 * markers ever appear in them: `**bold**` and `` `code` ``. The app's shared
 * Markdown component would render them — and would also pull the PlantUML
 * renderer (and ELK, its layout engine) into this page's client bundle, because
 * it imports one. Two markers do not justify a diagram engine, so this is the
 * one place the studio renders its own. Like the shared one it builds React
 * elements and never touches dangerouslySetInnerHTML, so agent text stays text.
 */
export function Prose({ text, className = "" }: { text: string; className?: string }) {
  return <span className={className}>{inlineMarkdown(text)}</span>;
}

export function inlineMarkdown(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([\s\S]+?)\*\*|`([^`]+)`/;
  let rest = text;
  let n = 0;
  while (rest.length) {
    const m = re.exec(rest);
    if (!m) {
      out.push(<Fragment key={`t${n++}`}>{rest}</Fragment>);
      break;
    }
    if (m.index > 0) out.push(<Fragment key={`t${n++}`}>{rest.slice(0, m.index)}</Fragment>);
    if (m[1] !== undefined) out.push(<strong key={`b${n++}`}>{m[1]}</strong>);
    else out.push(<code key={`c${n++}`} className={CODE}>{m[2]}</code>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

/** The inline code chip, written once — five surfaces here render one. */
export const CODE = "rounded bg-stone-100 px-1 py-0.5 text-[0.9em]";

/** A block of literal command text: the permission card, the empty state. */
export function CommandBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-sm text-ink dark:rounded-xl">
      <code>{children}</code>
    </pre>
  );
}
