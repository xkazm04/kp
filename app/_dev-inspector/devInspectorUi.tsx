"use client";

/* eslint-disable */

/**
 * Presentational chrome for {@link DevInspector} — highlight boxes, the
 * cursor-anchored source label, the breadcrumb HUD, and the nav-mode hint.
 * Kept separate so the inspector component stays focused on state + wiring
 * (and so each file stays small). Dev-only; never ships to production.
 */

import type { CSSProperties } from "react";

import { isLibraryPath, type LocEntry } from "./devLocate";

export const Z = 2147483646;
const ACCENT = "#38bdf8"; // cyan
const DIM = "#a855f7"; // purple — secondary (pointed) outline
const OK = "#34d399"; // green — copy confirmation

/** Split `src/a/b/File.tsx:88` → `{ dir: 'src/a/b/', file: 'File.tsx:88' }`. */
export function splitLoc(loc: string): { dir: string; file: string } {
  const slash = loc.lastIndexOf("/");
  return slash === -1
    ? { dir: "", file: loc }
    : { dir: loc.slice(0, slash + 1), file: loc.slice(slash + 1) };
}

function boxStyle(rect: DOMRect, color: string, dashed: boolean): CSSProperties {
  return {
    position: "fixed",
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    border: `${dashed ? 1 : 2}px ${dashed ? "dashed" : "solid"} ${color}`,
    borderRadius: 3,
    background: dashed ? "transparent" : `${color}1f`,
    pointerEvents: "none",
    boxSizing: "border-box",
    zIndex: Z,
  };
}

export function HighlightBox({
  rect,
  variant,
}: {
  rect: DOMRect;
  variant: "target" | "pointer";
}) {
  return (
    <div style={boxStyle(rect, variant === "target" ? ACCENT : DIM, variant === "pointer")} />
  );
}

/** A compact `File.tsx:line` chip pinned to the cursor's element. */
export function SourceLabel({ rect, loc }: { rect: DOMRect; loc: string }) {
  const { file } = splitLoc(loc);
  const above = rect.top > 22;
  const top = above ? rect.top - 20 : Math.min(rect.top + 2, window.innerHeight - 22);
  const left = Math.max(4, Math.min(rect.left, window.innerWidth - 260));
  return (
    <div
      style={{
        position: "fixed",
        top,
        left,
        zIndex: Z,
        pointerEvents: "none",
        font: "11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#0b1220",
        background: ACCENT,
        borderRadius: 4,
        padding: "1px 6px",
        fontWeight: 700,
        whiteSpace: "nowrap",
        boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
      }}
    >
      {file}
    </div>
  );
}

function CrumbRow({
  entry,
  isDefault,
  onCopy,
}: {
  entry: LocEntry;
  isDefault: boolean;
  onCopy: (loc: string) => void;
}) {
  const { dir, file } = splitLoc(entry.loc);
  const lib = isLibraryPath(entry.path);
  return (
    <button
      type="button"
      onClick={() => onCopy(entry.loc)}
      style={{
        display: "flex",
        gap: 2,
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        background: isDefault ? `${ACCENT}22` : "transparent",
        border: "none",
        borderRadius: 4,
        padding: "2px 4px",
        font: "inherit",
        wordBreak: "break-all",
      }}
    >
      <span style={{ color: ACCENT, opacity: isDefault ? 1 : 0 }}>▶</span>
      <span style={{ color: "#6b7280" }}>{dir}</span>
      <span style={{ color: lib ? "#9ca3af" : "#f1f5f9", fontWeight: 600 }}>{file}</span>
    </button>
  );
}

const PANEL: CSSProperties = {
  position: "fixed",
  left: 12,
  bottom: 12,
  maxWidth: 460,
  pointerEvents: "auto",
  font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "#e5e7eb",
  background: "rgba(17,24,39,0.94)",
  border: `1px solid ${ACCENT}66`,
  borderRadius: 8,
  boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
  padding: "8px 10px",
  backdropFilter: "blur(4px)",
};

export function InspectorHud({
  copied,
  copyOk,
  mappingOn,
  crumbs,
  defaultLoc,
  onCopy,
}: {
  copied: string | null;
  copyOk: boolean;
  mappingOn: boolean;
  crumbs: LocEntry[];
  defaultLoc: string | null;
  onCopy: (loc: string) => void;
}) {
  return (
    <div data-devinspector style={PANEL}>
      <div
        style={{
          color: copied ? (copyOk ? OK : "#fca5a5") : ACCENT,
          fontWeight: 700,
          marginBottom: 4,
        }}
      >
        {copied ? (copyOk ? "Copied ✓" : "Copy failed") : "⌖ DevInspector"}
      </div>
      {copied ? (
        <div style={{ wordBreak: "break-all" }}>{copied}</div>
      ) : !mappingOn ? (
        <div style={{ color: "#fca5a5", lineHeight: 1.6 }}>
          Source mapping is OFF. Relaunch with:
          <div style={{ color: ACCENT, marginTop: 2 }}>npm run dev:inspect</div>
        </div>
      ) : crumbs.length ? (
        crumbs.map((c, i) => (
          <CrumbRow
            key={`${c.loc}-${i}`}
            entry={c}
            isDefault={defaultLoc !== null && c.loc === defaultLoc}
            onCopy={onCopy}
          />
        ))
      ) : (
        <div style={{ color: "#9ca3af" }}>Hover a component…</div>
      )}
      <div style={{ color: "#6b7280", marginTop: 6, fontSize: 11 }}>
        right-click: call site · Alt+right-click: this element · click a row · Esc: exit
      </div>
    </div>
  );
}

/** Small bottom-left hint shown after `;`, prompting the second key. */
export function NavHint() {
  return (
    <div data-devinspector style={{ ...PANEL, pointerEvents: "none" }}>
      <span style={{ color: ACCENT, fontWeight: 700 }}>⌖ keyboard mode</span>
      <span style={{ color: "#9ca3af" }}>
        {" "}
        — press <b style={{ color: "#f1f5f9" }}>i</b> to inspect ·{" "}
        <b style={{ color: "#f1f5f9" }}>Esc</b> to cancel
      </span>
    </div>
  );
}
