export type FastDirectStatus =
  | "stable_direct"
  | "refreshable_direct"
  | "platform_direct"
  | "header_dependent"
  | "cookie_dependent"
  | "device_bound"
  | "ip_bound"
  | "geo_blocked"
  | "login_required"
  | "provider_required"
  | "drm"
  | "offline"
  | "invalid";

export interface FastDiscoveryRecord {
  platform: string;
  market: string;
  channelId?: string;
  channelName?: string;
  channelOwner?: string;
  officialPlatformPage: string;
  manifestCandidate?: string;
  sessionRequired: boolean;
  regionRequired: boolean;
  deviceRequired: boolean;
  directCompatibility: FastDirectStatus;
  failureReason?: string;
}

export interface FastAdapter {
  platform: string;
  markets: string[];
  discover(): Promise<FastDiscoveryRecord[]>;
}
