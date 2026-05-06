import type { SVGProps } from "react";

export function JobFitIcon(props: SVGProps<SVGSVGElement>) {
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
      <path
        d="M10 12a5 5 0 0 1 1.66-3.74L14 12l-2.34 3.74A5 5 0 0 1 10 12Z"
        fill="#d65a4a"
        stroke="none"
      />
      <path d="M9 4 14 12 9 20 4 12Z" />
      <circle cx="15" cy="12" r="5" />
      <circle cx="7" cy="12" r="0.95" fill="#526b4f" stroke="none" />
    </svg>
  );
}
