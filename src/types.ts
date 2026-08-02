export interface SourceConfig {
  name: string;
  url: string;
  enabled: boolean;
  countryScope?: string[];
  lastSuccessfulDownload?: string;
  parsedEntries?: number;
  workingPriorityCandidates?: number;
}

export interface PlaylistEntry {
  sourceName: string;
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
  groupTitle?: string;
  country?: string;
  category?: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  priorityId?: string;
  priorityName?: string;
  priorityCountry?: string;
  priorityCategory?: string;
  priorityOrder?: number;
}

export interface FastCheckResult {
  ok: boolean;
  finalUrl?: string;
  contentType?: string;
  kind?: "hls" | "dash" | "video";
  latencyMs?: number;
  reason?: string;
}

export interface MediaCheckResult {
  ok: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  bytesRead: number;
  reason?: string;
}

export interface ValidatedEntry extends PlaylistEntry {
  normalizedUrl: string;
  score: number;
  fast: FastCheckResult;
  media: MediaCheckResult;
}

export interface StatusOutput {
  updatedAt: string;
  sources: number;
  downloadedEntries: number;
  uniqueCandidates: number;
  fastCheckPassed: number;
  mediaCheckPassed: number;
  published: number;
  failed: number;
  duplicatesRemoved: number;
  countryCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  degraded: boolean;
  priorityChannels?: PriorityChannelStatus[];
}

export interface PriorityChannel {
  id: string;
  name: string;
  country: string;
  category: string;
  priority: number;
  core: boolean;
  aliases: string[];
  officialPages?: string[];
  directCandidates?: string[];
  officialSocial?: string[];
}

export interface PriorityChannelStatus {
  id: string;
  name: string;
  country: string;
  category: string;
  priority: number;
  aliasesChecked: number;
  candidatesFound: number;
  candidatesValidated: number;
  selectedSource?: string;
  status: "working" | "not_found" | "all_candidates_failed" | "provider_required" | "drm" | "geo_blocked" | "authentication_required";
  failureReason?: string;
}

export interface PriorityCandidateDetail {
  host: string;
  sourceName: string;
  result: string;
}

export interface MissingPriorityDetail {
  channel: string;
  id: string;
  previousStatus: string;
  aliasesChecked: string[];
  sourcesChecked: number;
  officialPagesChecked: number;
  officialSocialAccountsChecked: number;
  candidatesFound: number;
  candidates: PriorityCandidateDetail[];
  bestResult?: string;
  finalStatus: PriorityChannelStatus["status"];
}
