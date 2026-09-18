"use client";

// The SEPARATE audio-recording consent on the interview portal (spark
// ai-interview-parity). Declining never blocks the call.
//
// STUB — WP3 replaces the body with the checkbox and its copy (what is recorded, why,
// when it is deleted). Renders nothing until then, which is exactly today's portal.

export type RecordingConsentProps = {
  /** The workspace offers recording; false renders nothing. */
  offered: boolean;
  checked: boolean;
  /** Locked once a call is in flight, like the main consent. */
  disabled: boolean;
  onChange: (value: boolean) => void;
};

export function RecordingConsent(props: RecordingConsentProps) {
  void props;
  return null;
}
