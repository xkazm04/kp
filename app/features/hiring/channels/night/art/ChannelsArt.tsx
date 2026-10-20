import type { ComponentType } from "react";
import type { NightNode } from "../channelsNightPlumbing";
import { ChannelsArtAds, ChannelsArtCareers, ChannelsArtEmail, ChannelsArtFeeds } from "./ChannelsArtDoors";
import { ChannelsArtEdge, ChannelsArtRelay, ChannelsArtStudio } from "./ChannelsArtPlant";
import { ChannelsArtBook, ChannelsArtHouses } from "./ChannelsArtPost";

const ART: Record<NightNode | "houses", ComponentType> = {
  careers: ChannelsArtCareers,
  email: ChannelsArtEmail,
  ads: ChannelsArtAds,
  feeds: ChannelsArtFeeds,
  studio: ChannelsArtStudio,
  relay: ChannelsArtRelay,
  edge: ChannelsArtEdge,
  book: ChannelsArtBook,
  houses: ChannelsArtHouses,
};

/** The drawing of one building. Its state comes from the nearest `[data-cond]` ancestor. */
export function ChannelsArt({ node }: { node: NightNode | "houses" }) {
  const Drawing = ART[node];
  return <Drawing />;
}
