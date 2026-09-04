"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bold, Heading, Italic, List, ListOrdered, Underline as UnderlineIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { htmlToMarkdown, markdownToHtml } from "./markdown-html";

// A dependency-free WYSIWYG editor: a Word-like toolbar over a contentEditable
// surface that VISUALIZES formatting (bold, italic, underline, bullet/numbered
// lists, headings) while the value it exposes is plain MARKDOWN. Seeds from
// markdownToHtml(value) and reads back with htmlToMarkdown(innerHTML) — a
// round-trip pinned by markdown-html.test.ts — so it drops into anything backed by
// a markdown string (the JD "Describe the need" field, the template body) without
// changing the storage format or the {{placeholder}} contract.
//
// Formatting is applied with document.execCommand — deprecated but the only
// zero-dependency way to format a live selection, and reliable in Chromium. styles
// are semantic tags (styleWithCSS off) so the serializer sees <b>/<i>/<u>/<ul>.

// Child-element styling for the editable surface (the browser renders raw
// h/ul/strong/… with no classes). Tokens only, so both themes track.
const PROSE = [
  "[&_h1]:mt-3 [&_h1]:font-serif [&_h1]:text-h3 [&_h1]:font-semibold [&_h1]:text-ink",
  "[&_h2]:mt-3 [&_h2]:font-serif [&_h2]:text-h3 [&_h2]:font-semibold [&_h2]:text-ink",
  "[&_h3]:mt-2 [&_h3]:font-semibold [&_h3]:text-ink",
  "[&_p]:my-1.5",
  "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5",
  "[&_b]:font-semibold [&_strong]:font-semibold [&_strong]:text-ink",
  "[&_code]:rounded [&_code]:bg-stone-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]",
  "[&_:first-child]:mt-0",
].join(" ");

type Marks = { bold: boolean; italic: boolean; underline: boolean; ul: boolean; ol: boolean; heading: boolean };
const NO_MARKS: Marks = { bold: false, italic: false, underline: false, ul: false, ol: false, heading: false };

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = "",
  minHeight = "10rem",
  disabled = false,
  readOnly = false,
}: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  minHeight?: string;
  /** Lock the surface + toolbar (e.g. while a mutation is in flight), matching the
   *  disabled contract every sibling form control already honors. */
  disabled?: boolean;
  /** Read-only alias of `disabled` — same locked behavior, clearer intent. */
  readOnly?: boolean;
}) {
  const locked = disabled || readOnly;
  const tCommon = useTranslations("common");
  // Toolbar button names and the editor's own accessible name are the only strings
  // this primitive produces itself — and a shared primitive's literal is inherited by
  // every consumer, so an English one here reached all four locales on both builders
  // that mount the editor (JdsBuilder, JdsTemplateManagerEditor).
  const t = useTranslations("richTextEditor");
  const ref = useRef<HTMLDivElement>(null);
  // The markdown the editor's DOM currently reflects — so a `value` prop change we
  // DIDN'T originate (a Duplicate prefill, a reset) re-seeds, while our own onChange
  // echoes don't wipe the caret mid-type.
  const reflected = useRef<string>(value);
  const [isEmpty, setIsEmpty] = useState(!value.trim());
  const [marks, setMarks] = useState<Marks>(NO_MARKS);

  // One-time document config: keep formatting as semantic tags and paragraphs.
  useEffect(() => {
    try {
      document.execCommand("styleWithCSS", false, "false");
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // Non-fatal — formatting still works, output shape is just less predictable.
    }
  }, []);

  // Seed once on mount.
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.innerHTML = markdownToHtml(value);
      reflected.current = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-seed on an EXTERNAL value change only (value diverged from what we hold).
  useEffect(() => {
    const el = ref.current;
    if (!el || value === reflected.current) return;
    el.innerHTML = markdownToHtml(value);
    reflected.current = value;
    setIsEmpty(!value.trim());
  }, [value]);

  // Read the caret's active formatting into the toolbar — only when the selection
  // is inside this editor. Bails out (returns the SAME state object) when nothing
  // changed, so refreshing on every keystroke doesn't re-render.
  const refreshMarks = useCallback(() => {
    const el = ref.current;
    const sel = document.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return;
    const block = String(document.queryCommandValue("formatBlock") || "").toLowerCase();
    const next: Marks = {
      bold: safeState("bold"),
      italic: safeState("italic"),
      underline: safeState("underline"),
      ul: safeState("insertUnorderedList"),
      ol: safeState("insertOrderedList"),
      heading: /h[1-3]/.test(block),
    };
    setMarks((prev) =>
      prev.bold === next.bold &&
      prev.italic === next.italic &&
      prev.underline === next.underline &&
      prev.ul === next.ul &&
      prev.ol === next.ol &&
      prev.heading === next.heading
        ? prev
        : next
    );
  }, []);

  // selectionchange covers caret/mouse moves; keyUp on the editor covers a shortcut
  // (Ctrl/⌘+B/I/U) that toggles a mark WITHOUT moving the caret — so the button
  // lights up immediately, not one keystroke later.
  useEffect(() => {
    document.addEventListener("selectionchange", refreshMarks);
    return () => document.removeEventListener("selectionchange", refreshMarks);
  }, [refreshMarks]);

  const emit = () => {
    if (locked) return;
    const el = ref.current;
    if (!el) return;
    const md = htmlToMarkdown(el.innerHTML);
    reflected.current = md;
    setIsEmpty(!md.trim());
    onChange(md);
  };

  const run = (command: string, arg?: string) => {
    if (locked) return;
    ref.current?.focus();
    try {
      document.execCommand(command, false, arg);
    } catch {
      // ignore — an unsupported command is a no-op, never a crash
    }
    emit();
    refreshMarks();
  };

  const toggleHeading = () => {
    if (locked) return;
    ref.current?.focus();
    const cur = String(document.queryCommandValue("formatBlock") || "").toLowerCase();
    run("formatBlock", /h[1-3]/.test(cur) ? "p" : "h2");
  };

  return (
    <div
      className={`overflow-hidden rounded-md border border-stone-200 bg-white transition-colors focus-within:border-coral/50 focus-within:ring-2 focus-within:ring-coral/20 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-stone-200 bg-paper px-1.5 py-1" role="toolbar" aria-label={tCommon("formatting")} aria-disabled={locked || undefined}>
        <TB label={t("bold")} active={marks.bold} disabled={locked} onClick={() => run("bold")}>
          <Bold size={15} aria-hidden />
        </TB>
        <TB label={t("italic")} active={marks.italic} disabled={locked} onClick={() => run("italic")}>
          <Italic size={15} aria-hidden />
        </TB>
        <TB label={t("underline")} active={marks.underline} disabled={locked} onClick={() => run("underline")}>
          <UnderlineIcon size={15} aria-hidden />
        </TB>
        <span className="mx-1 h-5 w-px bg-stone-200" aria-hidden />
        <TB label={t("heading")} active={marks.heading} disabled={locked} onClick={toggleHeading}>
          <Heading size={15} aria-hidden />
        </TB>
        <TB label={t("bulletedList")} active={marks.ul} disabled={locked} onClick={() => run("insertUnorderedList")}>
          <List size={15} aria-hidden />
        </TB>
        <TB label={t("numberedList")} active={marks.ol} disabled={locked} onClick={() => run("insertOrderedList")}>
          <ListOrdered size={15} aria-hidden />
        </TB>
      </div>

      <div className="relative">
        {isEmpty && placeholder ? (
          <p className="pointer-events-none absolute left-3 top-2.5 text-sm text-steel">{placeholder}</p>
        ) : null}
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          // Always name the textbox: caller-supplied label, else the placeholder,
          // else a generic fallback — a role=textbox must never be nameless (a11y).
          aria-label={ariaLabel || placeholder || t("editorLabel")}
          aria-disabled={locked || undefined}
          contentEditable={!locked}
          suppressContentEditableWarning
          spellCheck
          onInput={emit}
          onBlur={emit}
          onKeyUp={refreshMarks}
          onMouseUp={refreshMarks}
          tabIndex={locked ? -1 : undefined}
          style={{ minHeight }}
          className={`block w-full overflow-y-auto px-3 py-2.5 text-sm leading-6 text-ink outline-none ${locked ? "cursor-not-allowed opacity-60" : ""} ${PROSE}`}
        />
      </div>
    </div>
  );
}

// queryCommandState throws in some states — never let a toolbar refresh crash.
function safeState(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

function TB({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      // Keep the editor's selection: a mousedown on the button must not blur it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`focus-ring inline-grid h-8 w-8 place-items-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
        active ? "bg-ink text-white" : "text-steel hover:bg-white hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
