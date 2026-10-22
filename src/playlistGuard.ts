// Bound all published URLs to protect GitHub, IPTV clients and M3U parsing.
// A successful probe does not make an expiring signed URL permanent.
export const MAX_STREAM_URL_LENGTH = 4096;
export const MAX_PLAYLIST_BYTES = 8 * 1024 * 1024;

export function isPublishableUrl(raw: string, now = Date.now()): boolean {
  if (!raw || raw.length > MAX_STREAM_URL_LENGTH || /[\s|]/.test(raw)) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (!url.hostname || url.username || url.password) return false;
    for (const key of ["exp", "expires", "expiry"]) {
      const value = url.searchParams.get(key);
      if (!value || !/^\d{10}(?:\d{3})?$/.test(value)) continue;
      const expiresAt = Number(value) * (value.length === 10 ? 1000 : 1);
      if (expiresAt < now + 3 * 60 * 60 * 1000) return false;
    }
    return true;
  } catch {
    return false;
  }
}
