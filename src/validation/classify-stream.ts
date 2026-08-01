import type { StreamCandidate, StabilityClass } from "../types.js";

export function classifyStability(
  candidate: StreamCandidate,
  requiresCookiesOrAuth: boolean
): StabilityClass {
  if (requiresCookiesOrAuth) {
    return "session_dependent";
  }

  try {
    const urlObj = new URL(candidate.streamUrl);
    const searchParams = urlObj.searchParams;
    
    const tokenKeys = [
      "token",
      "auth",
      "expires",
      "expiry",
      "exp",
      "signature",
      "sig",
      "hash",
      "hdnts",
      "hdnea",
      "security",
      "key",
      "pass"
    ];

    let hasToken = false;
    for (const key of tokenKeys) {
      if (searchParams.has(key)) {
        hasToken = true;
        break;
      }
    }

    // Check for large opaque query parameters
    if (!hasToken) {
      for (const [, val] of searchParams.entries()) {
        if (val.length > 30) {
          hasToken = true;
          break;
        }
      }
    }

    if (hasToken) {
      // If it comes from a dynamic scraping adapter (Yoda, Canlitv)
      // it means the adapter can re-discover it normally, hence refreshable_public.
      // If it's imported from a static list (m3u-import) without dynamic scraper,
      // it might expire and cannot be refreshed, hence short_lived.
      if (candidate.discoveryMethod === "m3u-import") {
        return "short_lived";
      }
      return "refreshable_public";
    }

    return "stable";
  } catch {
    return "unknown";
  }
}
