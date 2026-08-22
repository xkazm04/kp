import type { SVGProps } from "react";

// Accent fill through a CSS var, not the brand.ts JS mirror — see CompareIcon:
// the JS constants are the LIGHT values and do not follow [data-theme].

export function SalaryIcon(props: SVGProps<SVGSVGElement>) {
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
      <rect x="3" y="6.75" width="18" height="10.5" rx="5.25" />
      <path d="M8 10v5" />
      <path d="m8 12.5 2.6-2.5" />
      <path d="m8 12.5 2.6 2.5" />
      <path d="M15.5 10.5a2 2 0 1 0 0 4" />
      <circle cx="14.25" cy="8.6" r="0.85" fill="var(--color-moss)" stroke="none" />
    </svg>
  );
}
