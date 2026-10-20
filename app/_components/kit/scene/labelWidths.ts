/**
 * The drawn width of each label at the scene's label type (600, 14px, the page's sans), for a canvas
 * or SVG figure that must leave room for its own words (the orbit's ring counts). Measured with a
 * throwaway canvas in the page's real font; without a 2d context it estimates 9px per character.
 * Browser only: call it from an effect or a memo that runs on the client.
 */
export function labelWidths(labels: readonly string[]): number[] {
  const x = document.createElement("canvas").getContext("2d");
  if (!x) return labels.map((l) => l.length * 9);
  x.font = `600 14px ${getComputedStyle(document.body).fontFamily}`;
  return labels.map((l) => Math.ceil(x.measureText(l).width));
}
