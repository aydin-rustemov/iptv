import type { ValidationFailureCategory } from "../types.js";

export function categorizeValidationFailure(message: string): ValidationFailureCategory {
  const msg = message.toLowerCase();
  if (msg.includes("dns resolution failed") || msg.includes("enotfound")) return "dns_failure";
  if (msg.includes("private ip") || msg.includes("forbidden protocol") || msg.includes("embedded credentials") || msg.includes("localhost")) return "unsafe_url";
  if (msg.includes("timeout") && (msg.includes("connect") || msg.includes("aborted"))) return "connect_timeout";
  if (msg.includes("timeout") || msg.includes("econnreset") || msg.includes("socket")) return "read_timeout";
  if (msg.includes("http error 403") || msg.includes("http 403")) return "http_403";
  if (msg.includes("http error 404") || msg.includes("http 404")) return "http_404";
  if (msg.includes("http error 429") || msg.includes("http 429")) return "http_429";
  if (/http error 5\d\d/.test(msg) || /http 5\d\d/.test(msg)) return "http_5xx";
  if (msg.includes("received html")) return "html_instead_of_manifest";
  if (msg.includes("does not begin with #extm3u") || msg.includes("invalid hls")) return "invalid_hls_manifest";
  if (msg.includes("does not contain variants")) return "no_variant";
  if (msg.includes("does not contain segments")) return "no_media_segments";
  if (msg.includes("segment http")) return "segment_http_error";
  if (msg.includes("empty or too small")) return "segment_sample_too_small";
  if (msg.includes("ffprobe") || msg.includes("probe")) return "segment_probe_failed";
  if (msg.includes("init segment")) return "missing_fmp4_init_segment";
  if (msg.includes("encrypted") || msg.includes("drm")) return "unsupported_encryption";
  if (msg.includes("geo")) return "geo_blocked";
  if (msg.includes("referer")) return "header_required";
  if (msg.includes("401") || msg.includes("session") || msg.includes("cookie") || msg.includes("authorization")) return "session_required";
  return "unknown_network_error";
}

export function sanitizeValidationMessage(message: string): string {
  return message
    .replace(/([?&](token|auth|signature|sig|hdnts|hdnea|key|pass)=)[^&\s"]+/gi, "$1<redacted>")
    .replace(/(authorization|cookie):\s*[^\r\n]+/gi, "$1: <redacted>")
    .slice(0, 600);
}
