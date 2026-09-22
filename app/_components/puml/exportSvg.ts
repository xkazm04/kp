/** Download the expanded diagram as a standalone SVG in the reader's current theme. */
export function downloadDiagramSvg(svg: SVGSVGElement, title: string | null, background: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const sourceNodes = [svg, ...svg.querySelectorAll("*")];
  const exportedNodes = [clone, ...clone.querySelectorAll("*")];
  sourceNodes.forEach((source, index) => {
    const exported = exportedNodes[index];
    if (!exported) return;
    for (const property of ["fill", "stroke"] as const) {
      if (!source.getAttribute(property)?.includes("var(")) continue;
      const resolved = getComputedStyle(source).getPropertyValue(property).trim();
      if (resolved) exported.setAttribute(property, resolved);
    }
  });

  const bounds = svg.viewBox.baseVal;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(bounds.width));
  clone.setAttribute("height", String(bounds.height));
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  const backdrop = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  backdrop.setAttribute("width", "100%");
  backdrop.setAttribute("height", "100%");
  backdrop.setAttribute("fill", background);
  clone.insertBefore(backdrop, clone.firstChild);

  const name = (title ?? "diagram")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "diagram";
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.svg`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
