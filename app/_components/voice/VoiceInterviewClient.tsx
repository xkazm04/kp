"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { VoiceInterviewProps } from "./VoiceInterview";

function VoiceLoading() {
  const t = useTranslations("interview.voice");
  return <p className="text-base text-steel">{t("loading")}</p>;
}

// Client-only wrapper: the realtime SDKs touch browser-only APIs (WebRTC,
// AudioContext), so we skip SSR entirely and load on the client.
const Inner = dynamic(() => import("./VoiceInterview").then((m) => m.VoiceInterview), {
  ssr: false,
  loading: () => <VoiceLoading />,
});

export function VoiceInterviewClient(props: VoiceInterviewProps) {
  return <Inner {...props} />;
}
