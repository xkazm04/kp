"use client";

import type { ButtonHTMLAttributes } from "react";
import { KitIcon, type KitIconName } from "./icons";
import "./kit.css";

export type ButtonVariant = "primary" | "affirm" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  variant?: ButtonVariant;
  /** sm 32px, md 40px, lg 48px. */
  size?: ButtonSize;
  icon?: KitIconName;
  /** Icon only: the label becomes the accessible name AND the tip, never dropped. */
  iconOnly?: boolean;
  /** The label swaps (no spinner); the button stays put and refuses clicks. */
  loading?: boolean;
  loadingLabel?: string;
  /** A tip beside a visible label (an icon-only button always tips its label). */
  tip?: string;
};

/**
 * @catalog The kit button: primary / affirm / secondary / ghost / danger / link at 32/40/48px, icon or icon-only (label = aria-label + tip), a loading label instead of a spinner.
 */
export function Button({
  label, variant = "secondary", size = "md", icon, iconOnly = false, loading = false, loadingLabel, tip,
  disabled, className, type = "button", ...rest
}: Props) {
  const cls = [
    "k-btn",
    `k-btn--${variant}`,
    size !== "md" ? `k-btn--${size}` : "",
    iconOnly ? "k-btn--icon" : "",
    loading ? "is-loading" : "",
    // a caller-supplied loading label carries its own ellipsis ("Saving…"); only the bare label gets one
    loading && loadingLabel ? "has-loading-label" : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={iconOnly ? label : undefined}
      data-tip={iconOnly || tip ? (tip ?? label) : undefined}
      {...rest}
    >
      {icon ? <KitIcon name={icon} /> : null}
      {iconOnly ? null : loading ? (loadingLabel ?? label) : label}
    </button>
  );
}
