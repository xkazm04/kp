import type { SVGProps } from "react";

// Accent fills resolve through CSS vars, not the brand.ts JS mirror: this icon
// renders into the live DOM, where var() follows [data-theme], whereas the JS
// constant is the LIGHT value only and froze the dot at #526b4f on the Spark
// Dark surface (~2.1:1, i.e. gone). Same reasoning as CompareIcon/ScanAnimation;
// brand.ts is for the surfaces a stylesheet cannot reach (OG card, apple-icon).

export function ExtractionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 3h6.5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M10.5 3v3h3" />
      <path d="M5.5 8.25h3.5" />
      <path d="M5.5 10.75h5" />
      <path d="M5.5 13.25h4" />
      <circle cx="16.25" cy="15.25" r="3.75" />
      <path d="m18.9 17.9 2.6 2.6" />
      <circle cx="16.25" cy="15.25" r="0.9" fill="var(--color-moss)" stroke="none" />
    </svg>
  );
}
