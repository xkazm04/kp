"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { selectConsumesKeyWhileOpen } from "../select-keys";
import { KitIcon, type KitIconName } from "./icons";
import { menuKeyAction, menuPlacement, menuSummary, nextActiveIndex } from "./menuModel";
import "./kit.css";
import "./menu.css";

export type MenuOption = { value: string; label: string; disabled?: boolean };

type Props = {
  /** The dimension's or the action's name: the trigger's visible word and the list's accessible name. */
  label: string;
  options: readonly MenuOption[];
  /** Values currently on (a facet). An action menu passes none. */
  selected?: readonly string[];
  onSelect: (value: string) => void;
  /** Multi-select facet: toggles and stays open. Otherwise a pick commits and closes. */
  multiple?: boolean;
  /** facet: "Name  value +N" with a chevron, the filtering state when a multi facet has a value on.
   *  button: a kit button (secondary, or ghost when `quiet`), optionally icon-only. */
  look?: "facet" | "button";
  quiet?: boolean;
  icon?: KitIconName;
  iconOnly?: boolean;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Controlled open (e.g. a key that opens a picker); omit for a self-contained menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Shown as the list's only line when there is nothing to pick. */
  emptyText?: string;
};

/**
 * @catalog A menu on a trigger: a facet (its name + what is on; multi-select stays open, single commits) or an action list ("Move to…"). The list is portalled and pinned to the trigger (flipped above near the bottom edge); virtual focus: arrows, Home/End, Enter/Space, Esc returns focus, Tab leaves.
 */
export function Menu({
  label, options, selected = [], onSelect, multiple = false, look = "facet", quiet = false, icon, iconOnly = false,
  size = "md", disabled, open: openProp, onOpenChange, emptyText,
}: Props) {
  const t = useTranslations("kit.menu");
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [openState, setOpenState] = useState(false);
  const [active, setActive] = useState(0);
  const open = openProp ?? openState;
  const on = new Set(selected);
  const chosen = options.filter((o) => on.has(o.value)).map((o) => o.label);
  const summary = look === "facet" ? menuSummary(chosen) : null;
  const filtering = multiple && chosen.length > 0;
  const off = options.map((o) => Boolean(o.disabled));

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const openMenu = () => {
    const at = options.findIndex((o) => on.has(o.value) && !o.disabled);
    setActive(at >= 0 ? at : nextActiveIndex(-1, 1, off));
    setOpen(true);
  };
  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };
  const commit = (o: MenuOption | undefined) => {
    if (!o || o.disabled) return;
    onSelect(o.value);
    if (!multiple) close();
  };

  // Dismiss on outside interaction, on a scroll outside the list and on resize (the list is fixed).
  // The listeners read the latest close() through a ref (the useKitKeys shape), so they bind once per open.
  const latestClose = useRef(close);
  useEffect(() => {
    latestClose.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (trigger.current?.contains(t) || document.getElementById(listId)?.contains(t)) return;
      latestClose.current(false);
    };
    const resize = () => latestClose.current(false);
    document.addEventListener("mousedown", outside);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", resize);
    };
  }, [open, listId]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (open && selectConsumesKeyWhileOpen(e.key)) e.stopPropagation();
    const a = menuKeyAction(e.key, open);
    if (a.preventDefault) e.preventDefault();
    if (a.kind === "open") openMenu();
    else if (a.kind === "move") setActive((i) => nextActiveIndex(i, a.delta, off));
    else if (a.kind === "first") setActive(nextActiveIndex(-1, 1, off));
    else if (a.kind === "last") setActive(nextActiveIndex(options.length, -1, off));
    else if (a.kind === "commit") commit(options[active]);
    else if (a.kind === "close") close(a.returnFocus);
  };

  // Pin the list to the trigger without a state round trip: measured on mount of the list node.
  const place = (el: HTMLDivElement | null) => {
    const tr = trigger.current;
    if (!el || !tr) return;
    const p = menuPlacement(tr.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    el.style.top = `${p.top}px`;
    el.style.left = `${p.left}px`;
    el.style.minWidth = `${p.minWidth}px`;
    if (document.activeElement !== tr) tr.focus();
  };

  const cls =
    look === "facet"
      ? `k-menu__facet${size === "sm" ? " is-sm" : ""}${filtering ? " is-on" : ""}`
      : `k-btn k-btn--${quiet ? "ghost" : "secondary"}${size === "sm" ? " k-btn--sm" : ""}${iconOnly ? " k-btn--icon" : ""}`;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={cls}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-label={summary ? t("named", { label, value: summary }) : label}
        data-tip={iconOnly ? label : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        data-role="kit-menu"
      >
        {icon ? <KitIcon name={icon} /> : null}
        {iconOnly ? null : <span className="k-menu__label">{label}</span>}
        {summary ? <span className="k-menu__value">{summary}</span> : null}
        {iconOnly ? null : <KitIcon name="down" />}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="k-kit k-menu__layer">
              <div ref={place} className="k-menu" data-part="menu">
                <ul id={listId} role="listbox" aria-label={label} aria-multiselectable={multiple || undefined}>
                  {options.length === 0 && emptyText ? <li className="k-menu__empty">{emptyText}</li> : null}
                  {options.map((o, i) => (
                    <li
                      key={o.value}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={on.has(o.value)}
                      aria-disabled={o.disabled || undefined}
                      className={`k-menu__opt${i === active ? " is-active" : ""}`}
                      // Keep DOM focus on the trigger (the only element listening for the keys).
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => !o.disabled && setActive(i)}
                      onClick={() => commit(o)}
                    >
                      <span className="k-menu__check">{on.has(o.value) ? <KitIcon name="check" /> : null}</span>
                      <span>{o.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
