/* The small drawn glyphs about.js inlined as strings: the node's pen and check, Replay's arrow, the handwritten note's arrow,
   and the finale's seal. Decorative, always aria-hidden. */

export function PenIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4 16l2.5-.6L15.5 6.4a1.8 1.8 0 0 0-2.5-2.5L4 12.9z"
        fill="#fffdf8"
        stroke="#17202a"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.5 10.5l3.6 3.6 7.4-8"
        fill="none"
        stroke="#17202a"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ReplayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12a8 8 0 102.6-5.9M4 4v4.6h4.6" />
    </svg>
  );
}

export function NoteArrow() {
  return (
    <svg className="hn-arrow" viewBox="0 0 60 40" aria-hidden="true">
      <path
        d="M8 4 C 10 20, 24 30, 44 32 M44 32 l-8 -6 M44 32 l-9 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The seal where the line ends (the finale's #jackEnd). */
export function SealArt() {
  return (
    <svg viewBox="0 0 200 200" focusable="false">
      <defs>
        <radialGradient id="sealG" cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#f08b7c" />
          <stop offset=".55" stopColor="#d65a4a" />
          <stop offset="1" stopColor="#a13a2c" />
        </radialGradient>
      </defs>
      <path d="M62 128l-18 56 26-14 14 24 12-62z" fill="#caa54c" stroke="#17202a" strokeWidth="5" strokeLinejoin="round" />
      <path d="M138 128l18 56-26-14-14 24-12-62z" fill="#d65a4a" stroke="#17202a" strokeWidth="5" strokeLinejoin="round" />
      <circle cx="100" cy="86" r="66" fill="url(#sealG)" stroke="#17202a" strokeWidth="6" />
      <circle
        cx="100"
        cy="86"
        r="50"
        fill="none"
        stroke="#fdf8ee"
        strokeWidth="3"
        strokeDasharray="3 9"
        strokeLinecap="round"
        opacity=".7"
      />
      <path
        d="M72 88l19 19 38-42"
        fill="none"
        stroke="#fdf8ee"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
