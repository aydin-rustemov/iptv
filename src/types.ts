export type CountryCode = "AZ" | "TR" | "RU" | "OTHER";

export type StreamCandidate = {
  channelId: string;
  channelName: string;
  country: CountryCode;
  language?: string;
  category?: string;
  pageUrl: string;
  streamUrl: string;
  sourceName: string;
  discoveryMethod:
    | "html"
    | "embedded-script"
    | "iframe"
    | "browser-network"
    | "m3u-import";
  discoveredAt: string;
  metadata?: {
    iframeUrl?: string;
    requestResourceType?: string;
    responseContentType?: string;
    requiredHeaderNames?: string[];
    playbackHeaders?: PlaybackHeaders;
    headerRequirements?: HeaderRequirements;
    [key: string]: unknown;
  };
};

export type PlaybackHeaders = {
  userAgent?: string;
  referer?: string;
  origin?: string;
};

export type HeaderRequirements = {
  requiresUserAgent: boolean;
  requiresReferer: boolean;
  requiresOrigin: boolean;
  requiresCookie: boolean;
  requiresAuthorization: boolean;
};

export type StreamStatus =
  | "portable"
  | "portable_with_headers"
  | "local_relay_required"
  | "header_required"
  | "session_bound"
  | "expiring_token"
  | "geo_blocked"
  | "drm_or_encrypted"
  | "temporarily_unavailable"
  | "invalid"
  | "unsupported"
  | "not_checked_better_candidate_already_found";

export type StabilityClass =
  | "stable"
  | "refreshable_public"
  | "short_lived"
  | "session_dependent"
  | "unknown";

export type AdapterRunStatus =
  | "working"
  | "no_candidates"
  | "blocked"
  | "unsupported"
  | "failed";

export type ValidationFailureCategory =
  | "dns_failure"
  | "unsafe_url"
  | "connect_timeout"
  | "read_timeout"
  | "http_403"
  | "http_404"
  | "http_429"
  | "http_5xx"
  | "html_instead_of_manifest"
  | "invalid_hls_manifest"
  | "no_variant"
  | "no_media_segments"
  | "segment_http_error"
  | "segment_sample_too_small"
  | "segment_probe_failed"
  | "missing_fmp4_init_segment"
  | "unsupported_encryption"
  | "geo_blocked"
  | "header_required"
  | "session_required"
  | "unknown_network_error";

export interface SegmentSampleInfo {
  contentLength?: number;
  rangeRequested: boolean;
  rangeSupported: boolean;
  bytesRead: number;
  intentionallyTruncated: boolean;
}

export interface ValidationResult {
  channelId: string;
  channelName: string;
  country: CountryCode;
  category?: string;
  streamUrl: string;
  sourceName: string;
  status: StreamStatus;
  stability: StabilityClass;
  checkedAt: string;
  latencyMs?: number;
  failureReason?: string;
  failureCategory?: ValidationFailureCategory;

  manifestValid: boolean;
  mediaPlaylistValid: boolean;
  segmentValid: boolean;
  playlistAdvanced?: boolean;
  probeValid: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  segmentSample?: SegmentSampleInfo;
  separateAudioRendition?: boolean;
  audioPlaylistValidated?: boolean;
  playbackHeaders?: PlaybackHeaders;
  minimumRequiredHeaders?: string[];
  manifestValidatedWithHeaders?: boolean;
  segmentValidatedWithHeaders?: boolean;
  probeValidatedWithHeaders?: boolean;

  consecutiveFailures: number;
  lastSuccessfulValidation?: string;
}

export interface ChannelOverride {
  id: string;
  name?: string;
  country?: CountryCode;
  category?: string;
  enabled?: boolean;
  preferSource?: string;
  blockUrls?: string[];
  aliases?: string[];
}

export interface AppConfig {
  legacyDiscoveryEnabled: boolean;
  enabledAdapters: string[];
  countries: CountryCode[];
  discoveryTimeoutMs: number;
  validationTimeoutMs: number;
  browserTimeoutMs: number;
  concurrencyDiscovery: number;
  concurrencyValidation: number;
  maxRetries: number;
  outputDir: string;
  serverPort: number;
  maxCandidatesPerSource: number;
  maxTotalCandidates: number;
  maxSourcePages: number;
  browserCaptureTimeMs: number;
  manifestTimeoutMs: number;
  segmentTimeoutMs: number;
  ffprobeTimeoutMs: number;
  segmentSampleMaxBytes: number;
  playerProfile: "ott-navigator" | "vlc";
}
