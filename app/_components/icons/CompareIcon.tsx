import type { SVGProps } from "react";

export function CompareIcon(props: SVGProps<SVGSVGElement>) {
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
      <rect x="3" y="4" width="8" height="16" rx="1.5" fill="#dce7d0" stroke="currentColor" />
      <rect x="13" y="4" width="8" height="16" rx="1.5" fill="#f7d4ce" stroke="currentColor" />
      <line x1="5.5" y1="9" x2="8.5" y2="9" />
      <line x1="5.5" y1="12" x2="8.5" y2="12" />
      <line x1="5.5" y1="15" x2="7.5" y2="15" />
      <line x1="15.5" y1="9" x2="18.5" y2="9" />
      <line x1="15.5" y1="12" x2="18.5" y2="12" />
      <line x1="15.5" y1="15" x2="17.5" y2="15" />
    </svg>
  );
}
