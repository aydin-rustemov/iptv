export interface SourceConfig {
  name: string;
  url: string;
  enabled: boolean;
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
}
