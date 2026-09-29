// ---------------------------------------------------------------------------
// Untrusted text: make the invisible visible
// ---------------------------------------------------------------------------

const INVISIBLE = /[​-‏⁠-⁤﻿᠎‪-‮]/u;

export type TextSegment = { kind: "text"; text: string } | { kind: "invisible"; code: string };

/** A stranger's text split so every zero-width or direction-control character renders
 *  as a visible marker instead of vanishing. */
export function revealInvisible(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let buf = "";
  for (const ch of text) {
    if (INVISIBLE.test(ch)) {
      if (buf) out.push({ kind: "text", text: buf });
      buf = "";
      out.push({ kind: "invisible", code: `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}` });
    } else buf += ch;
  }
  if (buf) out.push({ kind: "text", text: buf });
  return out;
}
