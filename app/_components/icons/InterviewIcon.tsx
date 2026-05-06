import type { SVGProps } from "react";

export function InterviewIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="M5.25 4.75h9.5a1.5 1.5 0 0 1 1.5 1.5v6.5a1.5 1.5 0 0 1-1.5 1.5H10l-3 2.5v-2.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-6.5a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M8.25 8.5h6" />
      <path d="M8.25 11h4" />
      <circle cx="18.5" cy="17.25" r="1.5" fill="#d65a4a" stroke="none" />
      <path d="M15 21.25c.4-1.65 1.85-2.75 3.5-2.75s3.1 1.1 3.5 2.75" />
    </svg>
  );
}
