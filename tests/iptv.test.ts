import { describe, it, expect, vi } from "vitest";
import { parseChannelM3u, parseHlsManifest } from "../src/validation/parse-hls.js";
import { isPrivateIp, resolveAndCheckUrl } from "../src/validation/validate-url.js";
import { classifyStability } from "../src/validation/classify-stream.js";
import { categorizeValidationFailure } from "../src/validation/failure-category.js";
import { alignTransportStreamSample } from "../src/validation/media-sample.js";
import { deduplicateCandidates } from "../src/output/deduplicate.js";
import { escapeMetadata, generateM3uContent } from "../src/output/generate-m3u.js";
import { compareValidationResults } from "../src/output/rank-sources.js";
import { runDiscovery, selectCandidatesWithQuotas } from "../src/discovery/discover.js";
import { normalizeChannel, normalizeDisplayName, getPredefinedChannels } from "../src/discovery/normalize-channel.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { YodaAdapter } from "../src/sources/yoda.js";
import { CanlitvComAdapter } from "../src/sources/canlitv-com.js";
import { extractCanlitvChannelLinks } from "../src/sources/canlitv-com.js";
import {
  acceptsShootoutChannel,
  cellForRecord,
  classifyShootoutResult,
  decideRegionalPrimary,
  discoverIzleAlternatives,
  discoverVoloAlternatives,
  extractIframeUrls,
  extractMediaUrlsFromHtml,
  scoreShootoutSource,
  type ShootoutRecord
} from "../src/shootout.js";
import type { StreamCandidate, ValidationResult } from "../src/types.js";

describe("M3U and HLS Parsers", () => {
  it("should parse Extended M3U channel lists correctly", () => {
    const raw = `#EXTM3U
#EXTINF:-1 tvg-id="aztv" tvg-name="AzTV" group-title="Azərbaycan",AzTV
http://str.yodacdn.net/aztv/video.m3u8`;

    const parsed = parseChannelM3u(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.name).toBe("AzTV");
    expect(parsed[0]!.url).toBe("http://str.yodacdn.net/aztv/video.m3u8");
    expect(parsed[0]!.tvgId).toBe("aztv");
    expect(parsed[0]!.groupTitle).toBe("Azərbaycan");
  });

  it("should parse HLS master playlists and resolve relative variant URLs", () => {
    const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=720x576
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1080x1920
1080p/index.m3u8`;

    const baseUrl = "https://example.com/live/master.m3u8";
    const result = parseHlsManifest(master, baseUrl);

    expect(result.isMaster).toBe(true);
    expect(result.variants).toHaveLength(2);
    expect(result.variants[0]!.url).toBe("https://example.com/live/720p/index.m3u8");
    expect(result.variants[1]!.url).toBe("https://example.com/live/1080p/index.m3u8");
    expect(result.variants[0]!.width).toBe(720);
    expect(result.variants[0]!.height).toBe(576);
  });

  it("should parse HLS media playlists and resolve relative segment URLs", () => {
    const media = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:9.009,
segment1.ts
#EXTINF:9.009,
segment2.ts`;

    const baseUrl = "https://example.com/live/media.m3u8";
    const result = parseHlsManifest(media, baseUrl);

    expect(result.isMaster).toBe(false);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]!.url).toBe("https://example.com/live/segment1.ts");
    expect(result.segments[1]!.url).toBe("https://example.com/live/segment2.ts");
  });

  it("should parse fragmented MP4 init maps and separate audio renditions", () => {
    const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Main",URI="audio/main.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720,AUDIO="aud"
video/main.m3u8`;
    const parsedMaster = parseHlsManifest(master, "https://example.com/live/master.m3u8");
    expect(parsedMaster.audioRenditions[0]!.url).toBe("https://example.com/live/audio/main.m3u8");
    expect(parsedMaster.variants[0]!.audioGroupId).toBe("aud");

    const media = `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4,
seg1.m4s`;
    const parsedMedia = parseHlsManifest(media, "https://example.com/live/video/main.m3u8");
    expect(parsedMedia.mapUrl).toBe("https://example.com/live/video/init.mp4");
  });
});

describe("URL and IP Safety", () => {
  it("should identify private and loopback IPs correctly", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("192.168.1.100")).toBe(true);
    expect(isPrivateIp("172.16.5.5")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("0.0.0.0")).toBe(true);
    expect(isPrivateIp("224.0.0.1")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fc00::")).toBe(true);
    
    // Public IPs
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("104.244.42.1")).toBe(false);
  });

  it("should reject non-HTTP protocols and embedded credentials", async () => {
    await expect(resolveAndCheckUrl("ftp://example.com")).rejects.toThrow();
    await expect(resolveAndCheckUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(resolveAndCheckUrl("https://user:pass@example.com")).rejects.toThrow();
    await expect(resolveAndCheckUrl("https://localhost/stream.m3u8")).rejects.toThrow();
  });
});

describe("URL token classification", () => {
  it("should classify tokenized URLs as refreshable or short-lived", () => {
    const cand1: StreamCandidate = {
      channelId: "aztv",
      channelName: "AzTV",
      country: "AZ",
      pageUrl: "https://aztv.az",
      streamUrl: "https://str.yodacdn.net/aztv/index.m3u8?token=abc123xyz",
      sourceName: "yoda",
      discoveryMethod: "browser-network",
      discoveredAt: ""
    };

    const cand2: StreamCandidate = {
      channelId: "aztv",
      channelName: "AzTV",
      country: "AZ",
      pageUrl: "https://aztv.az",
      streamUrl: "https://str.yodacdn.net/aztv/index.m3u8?token=abc123xyz",
      sourceName: "public-iptv",
      discoveryMethod: "m3u-import",
      discoveredAt: ""
    };

    expect(classifyStability(cand1, false)).toBe("refreshable_public");
    expect(classifyStability(cand2, false)).toBe("short_lived");
    expect(classifyStability(cand1, true)).toBe("session_dependent");
  });
});

describe("Deduplication and Escaping", () => {
  it("should merge duplicate channel names and stream URLs", () => {
    const cands: StreamCandidate[] = [
      {
        channelId: "xezer-tv",
        channelName: "Xəzər TV",
        country: "AZ",
        pageUrl: "https://yoda.az",
        streamUrl: "https://str.yodacdn.net/xezer/index.m3u8",
        sourceName: "yoda",
        discoveryMethod: "html",
        discoveredAt: ""
      },
      {
        channelId: "xezer-tv",
        channelName: "Xezer TV",
        country: "AZ",
        pageUrl: "https://canlitv.com",
        streamUrl: "https://str.yodacdn.net/xezer/index.m3u8?tracking=123",
        sourceName: "canlitv-com",
        discoveryMethod: "html",
        discoveredAt: ""
      }
    ];

    const grouped = deduplicateCandidates(cands);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.candidates).toHaveLength(1); // One URL is filtered as duplicate
  });

  it("should escape metadata safely for M3Us", () => {
    expect(escapeMetadata('Xəzər "HD" TV')).toBe("Xəzər 'HD' TV");
  });
});

describe("Phase 2 candidate selection", () => {
  it("should preserve Azerbaijani priority candidates under global pressure", () => {
    const candidates: StreamCandidate[] = [
      makeCandidate("aztv", "AzTV", "AZ", "public-iptv", "https://a.example/aztv.m3u8"),
      ...Array.from({ length: 20 }, (_, index) =>
        makeCandidate(`tr-${index}`, `TR ${index}`, "TR", "public-iptv", `https://t.example/${index}.m3u8`)
      )
    ];
    const selected = selectCandidatesWithQuotas(candidates, 5);
    expect(selected.candidates.some((candidate) => candidate.channelId === "aztv")).toBe(true);
    expect(selected.report.globalQuotaDropped).toBeGreaterThan(0);
  });

  it("should enforce source quotas and record dropped candidates", () => {
    const candidates = Array.from({ length: 40 }, (_, index) =>
      makeCandidate(`az-${index}`, `AZ ${index}`, "AZ", "public-iptv", `https://az.example/${index}.m3u8`)
    );
    const selected = selectCandidatesWithQuotas(candidates, 130);
    expect(selected.candidates.filter((candidate) => candidate.sourceName === "public-iptv").length).toBeLessThanOrEqual(30);
    expect(selected.report.sourceQuotaDropped).toBeGreaterThan(0);
  });
});

describe("Canlitv extraction", () => {
  it("should prioritize Azerbaijani channel links from the list page", () => {
    const html = `<a href="/tr/xezer-tv-izle">Xezer Tv</a><a href="/tr/random">Random</a><a href="/tr/arb-24-tv-izle">ARB 24 TV</a>`;
    const links = extractCanlitvChannelLinks(html, "https://canlitv.com/tr");
    expect(links[0]!.name).toBe("ARB 24 TV");
    expect(links.some((link) => link.name.toLocaleLowerCase("az").includes("xəzər") && link.priority)).toBe(true);
  });

  it("should strip Canlitv title suffixes and normalize Azerbaijani names", () => {
    expect(normalizeDisplayName("Atv Azad TV Canlı izle | Canlitv.com")).toBe("Atv Azad TV");
    expect(normalizeChannel("Atv Azad TV Canlı izle | Canlitv.com")).toMatchObject({
      id: "atv-az",
      name: "ATV Azərbaycan",
      country: "AZ"
    });
    expect(normalizeChannel("ARB TV Canlı izle | Canlitv.com").id).toBe("arb");
    expect(normalizeChannel("ARB 24 TV Canlı izle | Canlitv.com").id).toBe("arb24");
    expect(normalizeChannel("Bakü TV Canlı izle | Canlitv.com").id).toBe("baku-tv");
    expect(normalizeChannel("Xezer Tv").id).toBe("xezer-tv");
  });

  it("should keep ATV Turkey and ATV Azerbaijan separate", () => {
    expect(normalizeChannel("ATV Canlı izle").id).toBe("atv-tr");
    expect(normalizeChannel("Atv Azad TV Canlı izle").id).toBe("atv-az");
  });

  it("should include the main Turkish channel registry", () => {
    const ids = new Set(getPredefinedChannels().filter((channel) => channel.country === "TR").map((channel) => channel.id));
    for (const id of ["trt-1", "show-tv", "star-tv", "atv-tr", "kanal-d", "now-tv", "trt-haber", "cnn-turk", "trt-cocuk"]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});

describe("Media sample helpers", () => {
  it("should align MPEG-TS samples to 188-byte packets", () => {
    const sample = Buffer.alloc(188 * 2 + 13);
    sample[0] = 0x47;
    const aligned = alignTransportStreamSample(sample);
    expect(aligned.length).toBe(188 * 2);
  });

  it("should categorize detailed validation failures", () => {
    expect(categorizeValidationFailure("HTTP Error 404: Not Found")).toBe("http_404");
    expect(categorizeValidationFailure("DNS resolution failed for example")).toBe("dns_failure");
    expect(categorizeValidationFailure("Expected manifest/media, but received HTML")).toBe("html_instead_of_manifest");
  });
});

describe("Source Ranking", () => {
  it("should rank portable streams above tokenized and session-bound ones", () => {
    const streamStable: ValidationResult = {
      channelId: "aztv",
      channelName: "AzTV",
      country: "AZ",
      streamUrl: "https://example.com/stable.m3u8",
      sourceName: "canlitv-com",
      status: "portable",
      stability: "stable",
      checkedAt: "",
      latencyMs: 100,
      manifestValid: true,
      mediaPlaylistValid: true,
      segmentValid: true,
      probeValid: true,
      hasVideo: true,
      hasAudio: true,
      consecutiveFailures: 0
    };

    const streamTokenized: ValidationResult = {
      ...streamStable,
      streamUrl: "https://example.com/stable.m3u8?token=xyz",
      stability: "refreshable_public",
      latencyMs: 50
    };

    const streamSession: ValidationResult = {
      ...streamStable,
      status: "session_bound",
      stability: "session_dependent"
    };

    // Compare: Stable vs Tokenized (stable must be preferred even if latency is higher)
    expect(compareValidationResults(streamStable, streamTokenized)).toBeLessThan(0);

    // Compare: Tokenized vs Session Bound
    expect(compareValidationResults(streamTokenized, streamSession)).toBeLessThan(0);
  });

  it("should prefer target-player-compatible Canlitv over a public fallback", () => {
    const canlitv: ValidationResult = makeResult("kanal-d", "Kanal D", "canlitv-com", "portable_with_headers", "refreshable_public");
    const fallback: ValidationResult = makeResult("kanal-d", "Kanal D", "public-iptv", "portable", "refreshable_public");
    expect(compareValidationResults(canlitv, fallback)).toBeLessThan(0);
  });
});

describe("Playlist header metadata", () => {
  it("should generate OTT/VLC-compatible user-agent and referrer lines only when required", () => {
    const result = makeResult("arb", "ARB", "canlitv-com", "portable_with_headers", "refreshable_public");
    result.playbackHeaders = {
      userAgent: "Mozilla/5.0 test",
      referer: "https://canlitv.com/tr/arb-tv-izle",
      origin: "https://canlitv.com"
    };
    result.minimumRequiredHeaders = ["User-Agent", "Referer"];
    const m3u = generateM3uContent([result], true);
    expect(m3u).toContain("#EXTVLCOPT:http-user-agent=Mozilla/5.0 test");
    expect(m3u).toContain("#EXTVLCOPT:http-referrer=https://canlitv.com/tr/arb-tv-izle");
    expect(m3u).not.toContain("Origin");
  });
});

describe("Russian M3U parser state", () => {
  it("should not shift URLs between valid Extended M3U entries", () => {
    const raw = `#EXTM3U
#EXTINF:-1 tvg-name="Channel A",Channel A
https://example.com/a.m3u8
#EXTINF:-1 tvg-name="Channel B",Channel B
https://example.com/b.m3u8
#EXTINF:-1 tvg-name="Channel C",Channel C
https://example.com/c.m3u8`;
    const parsed = parseChannelM3u(raw);
    expect(parsed.map((entry) => `${entry.name}:${entry.url}`)).toEqual([
      "Channel A:https://example.com/a.m3u8",
      "Channel B:https://example.com/b.m3u8",
      "Channel C:https://example.com/c.m3u8"
    ]);
  });

  it("should discard orphan URLs and keep the next entry aligned", () => {
    const raw = `#EXTM3U
https://example.com/orphan.m3u8
#EXTINF:-1 tvg-name="Channel B",Channel B
https://example.com/b.m3u8`;
    const parsed = parseChannelM3u(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: "Channel B", url: "https://example.com/b.m3u8" });
  });
});

describe("Phase 4 shootout rules", () => {
  it("should accept only the nine configured shootout channels", () => {
    expect(acceptsShootoutChannel("aztv")).toBe(true);
    expect(acceptsShootoutChannel("show-tv")).toBe(true);
    expect(acceptsShootoutChannel("rossiya-24")).toBe(true);
    expect(acceptsShootoutChannel("regional-random")).toBe(false);
    expect(acceptsShootoutChannel("ntv-mir")).toBe(false);
  });

  it("should discover VoloTV yayin alternatives", () => {
    const urls = discoverVoloAlternatives("https://tv.canlitvvolo.com/az-tv-izle/", `<a href="?yayin=1">1</a><a href="?yayin=2">2</a><a href="?yayin=3">3</a>`);
    expect(urls).toContain("https://tv.canlitvvolo.com/az-tv-izle/?yayin=1");
    expect(urls).toContain("https://tv.canlitvvolo.com/az-tv-izle/?yayin=2");
    expect(urls).toContain("https://tv.canlitvvolo.com/az-tv-izle/?yayin=3");
  });

  it("should discover izle.cc alternative links without assuming paths", () => {
    const urls = discoverIzleAlternatives("https://www.izle.cc/trt1/", `<a href="/trt1/1/">Alt 1</a><a href="/trt1/2/">Alt 2</a><a href="/news/">News</a>`);
    expect(urls).toContain("https://www.izle.cc/trt1/1/");
    expect(urls).toContain("https://www.izle.cc/trt1/2/");
    expect(urls).not.toContain("https://www.izle.cc/news/");
  });

  it("should extract official iframe and static media URLs", () => {
    const html = `<iframe src="/player"></iframe><video data-hls="https://cdn.example/live/master.m3u8"></video>`;
    expect(extractIframeUrls(html, "https://official.example/live")).toEqual(["https://official.example/player"]);
    expect(extractMediaUrlsFromHtml(html, "https://official.example/live")).toEqual(["https://cdn.example/live/master.m3u8"]);
  });

  it("should classify repeatable referer streams as stable_with_headers", () => {
    const first = makeResult("trt-1", "TRT 1", "izle.cc", "portable", "stable");
    const second = { ...first };
    expect(classifyShootoutResult(first, second, ["referer"], ["referer"])).toBe("stable_with_headers");
  });

  it("should mark 403 and origin-only streams unsuitable", () => {
    const blocked = makeResult("arb", "ARB", "VoloTV", "session_bound", "unknown");
    blocked.failureReason = "HTTP Error 403: Forbidden";
    expect(classifyShootoutResult(blocked, blocked)).toBe("blocked");
    const origin = makeResult("arb", "ARB", "VoloTV", "local_relay_required", "stable");
    expect(classifyShootoutResult(origin, origin, ["origin"], ["origin"])).toBe("browser_bound");
  });

  it("should score source suitability without rewarding browser dependence", () => {
    const directScore = scoreShootoutSource({
      independentlyPlayable: true,
      requiredHeaders: [],
      stableUrl: true,
      hasVideo: true,
      hasAudio: true,
      https: true,
      startupMs: 1000,
      multipleQualities: true,
      shortLivedToken: false,
      browserBound: false,
      cookieOrAuthorization: false,
      http403: false
    });
    const blockedScore = scoreShootoutSource({
      independentlyPlayable: false,
      requiredHeaders: ["origin"],
      stableUrl: false,
      hasVideo: true,
      hasAudio: true,
      https: true,
      startupMs: 1000,
      multipleQualities: true,
      shortLivedToken: false,
      browserBound: true,
      cookieOrAuthorization: false,
      http403: true
    });
    expect(directScore).toBeGreaterThan(blockedScore);
  });

  it("should decide regional winner only after two passing channels", () => {
    const records = [
      makeShootoutRecord("AZ", "aztv", "AzTV", "VoloTV", "stable_direct"),
      makeShootoutRecord("AZ", "arb", "ARB", "VoloTV", "stable_direct"),
      makeShootoutRecord("AZ", "xezer-tv", "Xəzər TV", "Official", "invalid")
    ];
    expect(decideRegionalPrimary(records, ["VoloTV", "Official", "Fallback"])).toBe("VoloTV");
    expect(decideRegionalPrimary(records.slice(0, 1), ["VoloTV", "Official", "Fallback"])).toBe("mixed per-channel");
  });

  it("should map source records to comparison cells", () => {
    expect(cellForRecord(makeShootoutRecord("TR", "trt-1", "TRT 1", "izle.cc", "stable_direct"))).toBe("PASS_DIRECT");
    expect(cellForRecord(makeShootoutRecord("TR", "trt-1", "TRT 1", "izle.cc", "refreshable_public"))).toBe("PASS_REFRESHABLE");
    expect(cellForRecord(makeShootoutRecord("TR", "trt-1", "TRT 1", "izle.cc", "browser_bound"))).toBe("FAIL_SESSION");
  });
});

describe("Error Isolation", () => {
  it("should ensure one failing adapter does not crash the entire discovery pipeline", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      enabledAdapters: ["yoda", "canlitv-com"]
    };

    // Mock yoda discover to throw an error
    vi.spyOn(YodaAdapter.prototype, "discover").mockRejectedValue(new Error("Network block"));
    // Mock canlitv-com discover to return successful candidates
    vi.spyOn(CanlitvComAdapter.prototype, "discover").mockResolvedValue({
      sourceName: "canlitv-com",
      status: "working",
      pagesVisited: 1,
      candidates: [
        {
          channelId: "trt1",
          channelName: "TRT 1",
          country: "TR",
          pageUrl: "https://canlitv.com/trt1",
          streamUrl: "https://cdn.com/trt1.m3u8",
          sourceName: "canlitv-com",
          discoveryMethod: "html",
          discoveredAt: ""
        }
      ],
      browserUsed: false,
      durationMs: 10,
      warnings: []
    });

    const cands = await runDiscovery(config);
    expect(cands).toHaveLength(1);
    expect(cands[0]!.channelId).toBe("trt1");
  });
});

function makeCandidate(
  channelId: string,
  channelName: string,
  country: StreamCandidate["country"],
  sourceName: string,
  streamUrl: string
): StreamCandidate {
  return {
    channelId,
    channelName,
    country,
    pageUrl: "https://example.com",
    streamUrl,
    sourceName,
    discoveryMethod: "m3u-import",
    discoveredAt: ""
  };
}

function makeResult(
  channelId: string,
  channelName: string,
  sourceName: string,
  status: ValidationResult["status"],
  stability: ValidationResult["stability"]
): ValidationResult {
  return {
    channelId,
    channelName,
    country: channelId === "kanal-d" ? "TR" : "AZ",
    category: "general",
    streamUrl: `https://example.com/${channelId}/${sourceName}.m3u8`,
    sourceName,
    status,
    stability,
    checkedAt: "",
    manifestValid: true,
    mediaPlaylistValid: true,
    segmentValid: true,
    probeValid: true,
    hasVideo: true,
    hasAudio: true,
    consecutiveFailures: 0
  };
}

function makeShootoutRecord(
  region: string,
  channelId: string,
  channel: string,
  sourceGroup: string,
  classification: ShootoutRecord["classification"]
): ShootoutRecord {
  const pass = ["stable_direct", "stable_with_headers", "refreshable_public"].includes(classification);
  return {
    region,
    channelId,
    channel,
    sourceGroup,
    sourceSite: sourceGroup,
    pageUrl: "https://example.com",
    discoveryMethod: "static-html",
    manifestValid: pass,
    segmentValid: pass,
    ffprobeValid: pass,
    requiredHeaders: [],
    cookiesRequired: false,
    authorizationRequired: false,
    repeatable: pass,
    classification,
    suitability: pass ? "m3u_ready" : "not_suitable",
    score: pass ? 90 : 0
  };
}
