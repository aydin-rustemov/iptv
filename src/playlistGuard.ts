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

/** A player web page with ?url=...m3u8 is NOT an M3U8 stream. */
export function isDirectManifestUrl(raw: string): boolean {
  if (!isPublishableUrl(raw)) return false;
  try {
    const url = new URL(raw);
    const pathname = url.pathname.toLowerCase();
    if (/player|embed|watch|viewer|webplayer|m3u8-player|hls-player/i.test(pathname)) return false;
    if (url.searchParams.has("url") || url.searchParams.has("src") || url.searchParams.has("streamUrl")) return false;
    return /\.(?:m3u8|mpd)$/.test(pathname) ||
      /\/(?:master|manifest|playlist)(?:\/|$)/.test(pathname);
  } catch { return false; }
}
