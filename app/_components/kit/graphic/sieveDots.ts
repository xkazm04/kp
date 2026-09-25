/*
 * The Sieve's dot field is ONE svg whose children are written as a string (one node per dot, up to the
 * budget), not as React elements: a pour moves every node on every frame, and reconciling ~400 elements
 * per frame is the cost the winner's "one SVG, one rAF loop" budget rules out. Only numbers and closed
 * enum values reach the markup - never a caller's words - so the string needs no escaping.
 */
import type { SieveDot } from "./sieveLayout.ts";
import { dotRadius, PITCH } from "./sieveLayout.ts";

const f1 = (v: number) => v.toFixed(1);

/** The class list of one dot: kind, tone, and the three states a caller can put it in. */
export function dotClass(d: SieveDot, dim: boolean, picked: boolean): string {
  const it = d.item;
  return `k-dot k-dot--${it.shape} k-tone--${it.tone ?? "default"}${it.needs ? " is-needs" : ""}${dim ? " is-dim" : ""}${picked ? " is-picked" : ""}`;
}

/** One dot's inner geometry: a halo when it waits on you, then its shape, then its bin count. */
export function dotBody(d: SieveDot, pitch: number = PITCH): string {
  const R = dotRadius(pitch);
  const it = d.item;
  let s = it.needs ? `<circle class="k-dot__halo" r="${f1(R + 2.6)}"/>` : "";
  if (it.shape === "solid") s += `<circle class="k-dot__fill" r="${f1(R)}"/>`;
  else if (it.shape === "half")
    s += `<circle class="k-dot__line" r="${f1(R - 0.6)}"/><path class="k-dot__fill" d="M0 ${f1(-R + 0.6)}a${f1(R - 0.6)} ${f1(R - 0.6)} 0 0 0 0 ${f1(2 * R - 1.2)}z"/>`;
  else if (it.shape === "exit") {
    const a = f1(-R + 1);
    const b = f1(R - 1);
    s += `<path class="k-dot__x" d="M${a} ${a}L${b} ${b}M${b} ${a}L${a} ${b}"/>`;
  } else s += `<circle class="k-dot__line${it.shape === "dashed" ? " is-dashed" : ""}" r="${f1(R - 0.6)}"/>`;
  if (it.n > 1) s += `<text class="k-dot__n" y="3.5">${Math.round(it.n)}</text>`;
  return s;
}

/** The whole field's markup, dots in order (the pour indexes them by position). */
export function fieldMarkup(dots: readonly SieveDot[], dim: ReadonlySet<string> | undefined, picked: string | undefined, pitch: number = PITCH): string {
  let html = "";
  for (const d of dots) {
    html += `<g class="${dotClass(d, Boolean(dim?.has(d.item.id)), picked === d.item.id)}" data-id="${cssSafeId(d.item.id)}" transform="translate(${f1(d.x)} ${f1(d.y)})">${dotBody(d, pitch)}</g>`;
  }
  return html;
}

/** Item ids are caller data; only [A-Za-z0-9_:.-] survive into an attribute. */
export function cssSafeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_:.-]/g, "_");
}
