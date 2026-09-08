"use client";

import type { LucideIcon } from "lucide-react";
import { Tooltip } from "@/app/_components/Tooltip";
import type { TooltipSide } from "@/app/_components/Tooltip";
import { railIconBtn } from "@/app/_components/ui/recipes";

// The one control both new coats use wherever the classic studio wrote a
// sentence: a glyph that carries its own name.
//
// The name is not decoration and it is not optional — it is the accessible name
// (`aria-label`), the hover label and the focus label, all from one `label`
// prop, so a control cannot ship with a picture and no meaning. `hint` is the
// second line a control sometimes owes: WHY it is unavailable, WHAT the toggle
// buys. It appears only in the tooltip, so it costs no layout.
//
// `on` renders the pressed state and, when a control is a toggle, publishes
// `aria-pressed`. `off` is not the same thing as `disabled`: a struck
// microphone with a reason is a designed state, a greyed one is a dead control.

export function IconAction({
  icon: Icon,
  label,
  hint,
  on,
  toggle = false,
  disabled = false,
  side = "top",
  tone = "default",
  size = 17,
  onClick,
}: {
  icon: LucideIcon;
  /** The control's name. Becomes aria-label, tooltip title and sr-only text. */
  label: string;
  /** Optional second sentence: the reason, the consequence, the shortcut. */
  hint?: string | null;
  on?: boolean;
  /** True when `on` means "pressed" rather than merely "active-looking". */
  toggle?: boolean;
  disabled?: boolean;
  side?: TooltipSide;
  /** `muted` draws the negative state: present, legible, plainly not available. */
  tone?: "default" | "muted" | "alert";
  size?: number;
  onClick?: () => void;
}) {
  const toneClass =
    tone === "muted"
      ? "text-stone-400 hover:text-steel"
      : tone === "alert"
        ? "text-coral hover:text-coral"
        : "";

  return (
    <Tooltip label={hint ? `${label} — ${hint}` : label} side={side}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={toggle ? Boolean(on) : undefined}
        className={`${railIconBtn(Boolean(on) && tone !== "muted")} ${toneClass} disabled:opacity-40`}
      >
        <Icon size={size} aria-hidden />
        <span className="sr-only">{label}</span>
      </button>
    </Tooltip>
  );
}
