"use client";

const INK = "#17202a";
const PAPER = "#f7f5ef";
const MOSS = "#526b4f";
const CORAL = "#d65a4a";
const STEEL = "#42606f";
const LIMEWASH = "#dce7d0";

export function ScanAnimationCompact({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 80"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Scanning CV"
    >
      <rect
        x="22"
        y="12"
        width="36"
        height="56"
        rx="3"
        fill={PAPER}
        stroke={INK}
        strokeWidth="2"
      />

      <g opacity="0.55" stroke={STEEL} strokeWidth="1.6" strokeLinecap="round">
        <line x1="28" y1="22" x2="48" y2="22" />
        <line x1="28" y1="28" x2="52" y2="28" />
        <line x1="28" y1="34" x2="46" y2="34" />
        <line x1="28" y1="40" x2="50" y2="40" />
        <line x1="28" y1="46" x2="44" y2="46" />
        <line x1="28" y1="52" x2="50" y2="52" />
        <line x1="28" y1="58" x2="42" y2="58" />
      </g>

      <g>
        <line
          x1="22"
          y1="14"
          x2="58"
          y2="14"
          stroke={MOSS}
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.9"
        >
          <animate
            attributeName="y1"
            values="14;66;14"
            keyTimes="0;0.5;1"
            dur="2.4s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="y2"
            values="14;66;14"
            keyTimes="0;0.5;1"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </line>

        <circle r="2.4" fill={CORAL}>
          <animate
            attributeName="cx"
            values="32;48;36;52;32"
            keyTimes="0;0.25;0.55;0.8;1"
            dur="2.4s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="cy"
            values="14;30;46;58;66"
            keyTimes="0;0.25;0.55;0.8;1"
            dur="2.4s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0;1;1;1;0"
            keyTimes="0;0.15;0.5;0.85;1"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </circle>
      </g>
    </svg>
  );
}

export function ScanAnimationWide({
  complete,
  className
}: {
  complete: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 480 80"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={complete ? "Analysis complete" : "Analyzing profile"}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        x="14"
        y="8"
        width="92"
        height="64"
        rx="4"
        fill={PAPER}
        stroke={INK}
        strokeWidth="1.6"
      />
      <rect x="14" y="8" width="92" height="10" rx="4" fill={LIMEWASH} />

      <g opacity="0.55" stroke={STEEL} strokeWidth="1.4" strokeLinecap="round">
        <line x1="22" y1="26" x2="74" y2="26" />
        <line x1="22" y1="32" x2="92" y2="32" />
        <line x1="22" y1="38" x2="68" y2="38" />
        <line x1="22" y1="44" x2="86" y2="44" />
        <line x1="22" y1="50" x2="62" y2="50" />
        <line x1="22" y1="56" x2="80" y2="56" />
        <line x1="22" y1="62" x2="58" y2="62" />
      </g>

      <line
        x1="14"
        y1="12"
        x2="106"
        y2="12"
        stroke={MOSS}
        strokeWidth="2"
        strokeLinecap="round"
        opacity={complete ? 0 : 0.95}
      >
        <animate
          attributeName="y1"
          values="12;68;12"
          keyTimes="0;0.5;1"
          dur="2.6s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="y2"
          values="12;68;12"
          keyTimes="0;0.5;1"
          dur="2.6s"
          repeatCount="indefinite"
        />
      </line>

      <g opacity={complete ? 0 : 1}>
        <Pulse delay="0s" startY="26" />
        <Pulse delay="0.6s" startY="44" />
        <Pulse delay="1.2s" startY="56" />
      </g>

      <Chip
        x={160}
        y={14}
        width={70}
        label="5+ yrs"
        delay="0.2s"
        complete={complete}
      />
      <Chip
        x={248}
        y={32}
        width={92}
        label="Python · React"
        delay="0.9s"
        complete={complete}
      />
      <Chip
        x={358}
        y={50}
        width={86}
        label="Senior IC"
        delay="1.5s"
        complete={complete}
      />

      <line
        x1="106"
        y1="40"
        x2="160"
        y2="22"
        stroke={CORAL}
        strokeWidth="1.2"
        strokeDasharray="2 3"
        opacity={complete ? 0.25 : 0.5}
      />
      <line
        x1="106"
        y1="40"
        x2="248"
        y2="40"
        stroke={CORAL}
        strokeWidth="1.2"
        strokeDasharray="2 3"
        opacity={complete ? 0.25 : 0.5}
      />
      <line
        x1="106"
        y1="40"
        x2="358"
        y2="58"
        stroke={CORAL}
        strokeWidth="1.2"
        strokeDasharray="2 3"
        opacity={complete ? 0.25 : 0.5}
      />
    </svg>
  );
}

function Pulse({ delay, startY }: { delay: string; startY: string }) {
  return (
    <circle r="3" fill={CORAL}>
      <animate
        attributeName="cx"
        values="60;106;200"
        keyTimes="0;0.4;1"
        dur="1.8s"
        begin={delay}
        repeatCount="indefinite"
      />
      <animate
        attributeName="cy"
        values={`${startY};${startY};40`}
        keyTimes="0;0.4;1"
        dur="1.8s"
        begin={delay}
        repeatCount="indefinite"
      />
      <animate
        attributeName="opacity"
        values="0;1;0.9;0"
        keyTimes="0;0.2;0.7;1"
        dur="1.8s"
        begin={delay}
        repeatCount="indefinite"
      />
      <animate
        attributeName="r"
        values="2;3.4;1.8"
        keyTimes="0;0.4;1"
        dur="1.8s"
        begin={delay}
        repeatCount="indefinite"
      />
    </circle>
  );
}

function Chip({
  x,
  y,
  width,
  label,
  delay,
  complete
}: {
  x: number;
  y: number;
  width: number;
  label: string;
  delay: string;
  complete: boolean;
}) {
  const cx = x + width / 2;
  const cy = y + 14;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height="22"
        rx="11"
        fill={PAPER}
        stroke={INK}
        strokeWidth="1.4"
        opacity={complete ? 1 : 0}
      >
        {!complete ? (
          <>
            <animate
              attributeName="opacity"
              values="0;0;1;1"
              keyTimes="0;0.2;0.55;1"
              dur="3s"
              begin={delay}
              repeatCount="indefinite"
            />
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 6;0 0;0 0"
              keyTimes="0;0.55;1"
              dur="3s"
              begin={delay}
              repeatCount="indefinite"
            />
          </>
        ) : null}
      </rect>
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill={INK}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        opacity={complete ? 1 : 0}
      >
        {label}
        {!complete ? (
          <>
            <animate
              attributeName="opacity"
              values="0;0;1;1"
              keyTimes="0;0.3;0.6;1"
              dur="3s"
              begin={delay}
              repeatCount="indefinite"
            />
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 6;0 0;0 0"
              keyTimes="0;0.55;1"
              dur="3s"
              begin={delay}
              repeatCount="indefinite"
            />
          </>
        ) : null}
      </text>
    </g>
  );
}
