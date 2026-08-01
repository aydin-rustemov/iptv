import type { AppConfig, PlaybackHeaders, StreamCandidate, ValidationResult, StreamStatus } from "../types.js";
import { fetchSafe } from "./fetch-manifest.js";
import { parseHlsManifest } from "./parse-hls.js";
import { probeMediaSample } from "./probe-stream.js";
import { classifyStability } from "./classify-stream.js";
import { resolveAndCheckUrl } from "./validate-url.js";
import { downloadBoundedMediaSample } from "./media-sample.js";
import { categorizeValidationFailure, sanitizeValidationMessage } from "./failure-category.js";

export async function validateCandidate(
  candidate: StreamCandidate,
  config: AppConfig,
  previousResult?: ValidationResult
): Promise<ValidationResult> {
  const checkedAt = new Date().toISOString();
  const baseResult: Omit<ValidationResult, "status" | "stability"> = {
    channelId: candidate.channelId,
    channelName: candidate.channelName,
    country: candidate.country,
    streamUrl: candidate.streamUrl,
    sourceName: candidate.sourceName,
    category: candidate.category,
    checkedAt,
    manifestValid: false,
    mediaPlaylistValid: false,
    segmentValid: false,
    probeValid: false,
    hasVideo: false,
    hasAudio: false,
    consecutiveFailures: previousResult ? previousResult.consecutiveFailures : 0,
    lastSuccessfulValidation: previousResult?.lastSuccessfulValidation
  };

  let attempt = 0;
  let lastError: Error | null = null;
  let latencyMs = 0;

  // Retry loop (at most config.maxRetries)
  while (attempt < config.maxRetries) {
    attempt++;
    const attemptStart = Date.now();
    try {
      // 1. SSRF and Protocol check
      await resolveAndCheckUrl(candidate.streamUrl);
      const playbackHeaders = getPlaybackHeaders(candidate);

      // 2. Fetch master manifest
      const manifestRes = await fetchSafe(candidate.streamUrl, {
        timeoutMs: config.manifestTimeoutMs,
        limitBytes: 2 * 1024 * 1024, // 2MB max manifest
        headers: playbackHeaders
      });

      latencyMs = Date.now() - attemptStart;
      baseResult.manifestValid = true;

      const bodyText = manifestRes.body.toString("utf8").trim();
      if (!bodyText.startsWith("#EXTM3U")) {
        throw new Error("Manifest does not begin with #EXTM3U");
      }

      // 3. Parse manifest
      const parsedHls = parseHlsManifest(bodyText, manifestRes.finalUrl);
      let mediaPlaylistBody = bodyText;
      let mediaPlaylistUrl = manifestRes.finalUrl;
      let separateAudioRendition = false;
      let audioPlaylistValidated = false;

      if (parsedHls.isMaster) {
        if (parsedHls.variants.length === 0) {
          throw new Error("Master playlist does not contain variants");
        }
        // Choose a variant (prefer high height/bandwidth, fallback to first)
        const selectedVariant = parsedHls.variants.reduce((prev, curr) => {
          if (!prev) return curr;
          const prevHeight = prev.height ?? 0;
          const currHeight = curr.height ?? 0;
          if (currHeight > prevHeight) return curr;
          if (currHeight === prevHeight && (curr.bandwidth ?? 0) > (prev.bandwidth ?? 0)) {
            return curr;
          }
          return prev;
        }, parsedHls.variants[0]!);
        const audioRendition = selectedVariant.audioGroupId
          ? parsedHls.audioRenditions.find((rendition) => rendition.groupId === selectedVariant.audioGroupId && rendition.url)
          : undefined;
        separateAudioRendition = !!audioRendition;

        // Fetch selected media playlist
        await resolveAndCheckUrl(selectedVariant.url);
        const variantRes = await fetchSafe(selectedVariant.url, {
          timeoutMs: config.manifestTimeoutMs,
          limitBytes: 2 * 1024 * 1024,
          headers: playbackHeaders
        });
        mediaPlaylistBody = variantRes.body.toString("utf8").trim();
        mediaPlaylistUrl = variantRes.finalUrl;
        
        if (!mediaPlaylistBody.startsWith("#EXTM3U")) {
          throw new Error("Variant media playlist does not begin with #EXTM3U");
        }

        if (audioRendition?.url) {
          const audioRes = await fetchSafe(audioRendition.url, {
            timeoutMs: config.manifestTimeoutMs,
            limitBytes: 2 * 1024 * 1024,
            headers: playbackHeaders
          });
          const audioText = audioRes.body.toString("utf8").trim();
          const audioParsed = parseHlsManifest(audioText, audioRes.finalUrl);
          audioPlaylistValidated = audioText.startsWith("#EXTM3U") && audioParsed.segments.length > 0;
        }
      }

      baseResult.mediaPlaylistValid = true;
      const mediaParsed = parseHlsManifest(mediaPlaylistBody, mediaPlaylistUrl);

      if (mediaParsed.segments.length === 0) {
        throw new Error("Media playlist does not contain segments");
      }

      // Fetch at least one segment sample
      const selectedSegment = mediaParsed.segments[0]!;
      await resolveAndCheckUrl(selectedSegment.url);
      let sample = await downloadBoundedMediaSample(selectedSegment.url, {
        timeoutMs: config.segmentTimeoutMs,
        maxBytes: config.segmentSampleMaxBytes,
        headers: playbackHeaders
      });
      let sampleBuffer = sample.body;

      if (mediaParsed.mapUrl) {
        const initRes = await fetchSafe(mediaParsed.mapUrl, {
          timeoutMs: config.segmentTimeoutMs,
          limitBytes: 1024 * 1024,
          headers: playbackHeaders
        });
        if (initRes.body.length === 0) {
          throw new Error("Missing fMP4 init segment");
        }
        sampleBuffer = Buffer.concat([initRes.body, sample.body]);
      }

      if (sampleBuffer.length < 100) {
        throw new Error("Fetched segment is empty or too small");
      }
      baseResult.segmentValid = true;
      baseResult.segmentSample = sample.info;

      // Probe stream via local ffprobe execution
      let probeRes;
      try {
        probeRes = await probeMediaSample(sampleBuffer, config.ffprobeTimeoutMs);
      } catch (err) {
        const retryMaxBytes = Math.max(config.segmentSampleMaxBytes, 16 * 1024 * 1024);
        if (!mediaParsed.mapUrl && retryMaxBytes > config.segmentSampleMaxBytes) {
          sample = await downloadBoundedMediaSample(selectedSegment.url, {
            timeoutMs: config.segmentTimeoutMs,
            maxBytes: retryMaxBytes,
            headers: playbackHeaders
          });
          baseResult.segmentSample = sample.info;
          probeRes = await probeMediaSample(sample.body, config.ffprobeTimeoutMs);
        } else {
          throw err;
        }
      }
      baseResult.probeValid = true;
      baseResult.hasVideo = probeRes.hasVideo;
      baseResult.hasAudio = probeRes.hasAudio || audioPlaylistValidated;
      baseResult.videoCodec = probeRes.videoCodec;
      baseResult.audioCodec = probeRes.audioCodec;
      baseResult.width = probeRes.width;
      baseResult.height = probeRes.height;
      baseResult.separateAudioRendition = separateAudioRendition;
      baseResult.audioPlaylistValidated = audioPlaylistValidated || undefined;

      if (!probeRes.hasVideo && !probeRes.hasAudio && !audioPlaylistValidated) {
        throw new Error("Stream does not contain any audio or video tracks");
      }

      // Determine stream status and stability
      const hasCookie = candidate.metadata?.requiredHeaderNames?.includes("cookie") || false;
      const hasAuth = candidate.metadata?.requiredHeaderNames?.includes("authorization") || false;
      const hasReferer = candidate.metadata?.requiredHeaderNames?.includes("referer") || false;
      const hasOrigin = candidate.metadata?.requiredHeaderNames?.includes("origin") || false;
      const hasUserAgent = !!playbackHeaders["User-Agent"];
      const requiresCookiesOrAuth = hasCookie || hasAuth;

      let status: StreamStatus = "portable";
      if (requiresCookiesOrAuth) {
        status = "session_bound";
      } else if (hasOrigin) {
        status = "local_relay_required";
      } else if (hasReferer || hasUserAgent) {
        status = "portable_with_headers";
      }

      const stability = classifyStability(candidate, requiresCookiesOrAuth);

      // If validation is successful, reset consecutive failures
      return {
        ...baseResult,
        status,
        stability,
        latencyMs,
        consecutiveFailures: 0,
        lastSuccessfulValidation: checkedAt,
        playbackHeaders: candidate.metadata?.playbackHeaders as PlaybackHeaders | undefined,
        minimumRequiredHeaders: getMinimumHeaderNames(playbackHeaders, hasReferer, hasOrigin),
        manifestValidatedWithHeaders: Object.keys(playbackHeaders).length > 0 || undefined,
        segmentValidatedWithHeaders: Object.keys(playbackHeaders).length > 0 || undefined,
        probeValidatedWithHeaders: Object.keys(playbackHeaders).length > 0 || undefined
      };
    } catch (err: any) {
      lastError = err;
      // Exponential backoff / jitter
      if (attempt < config.maxRetries) {
        const delay = Math.min(2000, 500 * Math.pow(2, attempt)) + Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // If we reach here, validation failed after all retries
  const msg = sanitizeValidationMessage(lastError?.message || "Unknown error");
  const failureCategory = categorizeValidationFailure(msg);
  let status: StreamStatus = "invalid";
  if (msg.includes("timeout") || msg.includes("Timeout")) {
    status = "temporarily_unavailable";
  } else if (msg.includes("SSRF") || msg.includes("private IP") || msg.includes("forbidden") || msg.includes("Localhost")) {
    status = "invalid";
  } else if (msg.includes("403") || msg.includes("401") || msg.includes("Session") || msg.includes("session")) {
    status = "session_bound";
  }

  const consecutiveFailures = (previousResult ? previousResult.consecutiveFailures : 0) + 1;

  return {
    ...baseResult,
    status,
    stability: "unknown",
    latencyMs,
    failureReason: msg,
    failureCategory,
    consecutiveFailures
  };
}

function getPlaybackHeaders(candidate: StreamCandidate): Record<string, string> {
  const headers: Record<string, string> = {};
  const playback = candidate.metadata?.playbackHeaders as PlaybackHeaders | undefined;
  if (playback?.userAgent) headers["User-Agent"] = playback.userAgent;
  if (playback?.referer) headers["Referer"] = playback.referer;
  if (playback?.origin) headers["Origin"] = playback.origin;
  return headers;
}

function getMinimumHeaderNames(headers: Record<string, string>, hasReferer: boolean, hasOrigin: boolean): string[] {
  const names: string[] = [];
  if (headers["User-Agent"]) names.push("user-agent");
  if (headers["Referer"] || hasReferer) names.push("referer");
  if (headers["Origin"] || hasOrigin) names.push("origin");
  return names;
}
