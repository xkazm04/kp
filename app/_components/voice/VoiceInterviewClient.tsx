"use client";

import dynamic from "next/dynamic";
import type { VoiceInterviewProps } from "./VoiceInterview";

// Client-only wrapper: the realtime SDKs touch browser-only APIs (WebRTC,
// AudioContext), so we skip SSR entirely and load on the client.
const Inner = dynamic(() => import("./VoiceInterview").then((m) => m.VoiceInterview), {
  ssr: false,
  loading: () => <p className="text-base text-steel">Loading voice interview…</p>,
});

export function VoiceInterviewClient(props: VoiceInterviewProps) {
  return <Inner {...props} />;
}
