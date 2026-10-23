import { randomUUID } from "node:crypto";
import { YODA_CATALOGUE } from "../sources/yodaCatalogue.js";

export type YodaChannel = (typeof YODA_CATALOGUE)[number];
const HLS_HOST = /(?:^|\.)yodacdn\.net$/i;
export const PLAYER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export function allowedUpstream(raw: string): boolean {
  try {
    const uri = new URL(raw);
    return uri.protocol === "https:" && HLS_HOST.test(uri.hostname) &&
      !uri.username && !uri.password && uri.port === "" &&
      !/(?:^|\/)\.\.(?:\/|$)/.test(uri.pathname);
  } catch { return false; }
}

export function channelById(id: string): YodaChannel | undefined {
  return YODA_CATALOGUE.find(channel => channel.id === id);
}

// Exact broadcaster path is crucial: the Yoda ARB page was observed requesting
// /ntv/video.m3u8, which is NOT ARB and must not be sent as an ARB stream.
export function matchesChannel(raw: string, channel: YodaChannel): boolean {
  if (!allowedUpstream(raw)) return false;
  const uri = new URL(raw);
  const pathChannel = uri.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  return channel.slugs.includes(pathChannel);
}

export function tokenExpiryMs(raw: string): number {
  try {
    const token = new URL(raw).searchParams.get("token");
    if (!token) return Date.now() + 60_000;
    // This reads expiry only. It does not alter or create a token.
    const data = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
    const exp = Number(data.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : Date.now() + 30_000;
  } catch { return Date.now() + 30_000; }
}

export type MediaRef = { channelId: string; url: string; expires: number };

/** Opaque in-memory references prevent arbitrary URL proxying / SSRF. */
export class MediaRegistry {
  private refs = new Map<string, MediaRef>();
  constructor(private readonly max = 30_000) {}
  register(channelId: string, raw: string): string {
    if (!allowedUpstream(raw)) throw new Error("Blocked non-Yoda media URI");
    this.expire();
    if (this.refs.size >= this.max) {
      const oldest = this.refs.keys().next().value;
      if (oldest) this.refs.delete(oldest);
    }
    const key = randomUUID();
    this.refs.set(key, { channelId, url: raw, expires: Date.now() + 120_000 });
    return key;
  }
  lookup(key: string): MediaRef | undefined {
    const ref = this.refs.get(key);
    if (!ref) return undefined;
    if (ref.expires <= Date.now()) { this.refs.delete(key); return undefined; }
    return ref;
  }
  expire(): void {
    const now = Date.now();
    for (const [id, ref] of this.refs) if (ref.expires <= now) this.refs.delete(id);
  }
}

/** Replace HLS variants, segments, encryption keys and init map URIs. */
export function rewriteHls(
  manifest: string, upstreamUrl: string, channelId: string, baseUrl: string, registry: MediaRegistry
): string {
  const base = new URL(upstreamUrl);
  const wrap = (raw: string): string => {
    const absolute = new URL(raw, base).toString();
    if (!allowedUpstream(absolute)) throw new Error("Disallowed media host in HLS");
    const ref = registry.register(channelId, absolute);
    return new URL("/media/" + ref, baseUrl).toString();
  };
  return manifest.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_match, url: string) => 'URI="' + wrap(url) + '"');
    }
    return wrap(trimmed);
  }).join("\n");
}

export function manifestForGateway(
  channels: ReadonlyArray<YodaChannel>, baseUrl: string
): string {
  const headers = ["#EXTM3U"];
  for (const c of channels) {
    headers.push('#EXTINF:-1 tvg-id="' + c.id + '" tvg-name="' +
      c.name.replace(/"/g, "") + '" group-title="Azərbaycan",' + c.name);
    headers.push(new URL("/live/" + encodeURIComponent(c.id) + "/index.m3u8", baseUrl).toString());
  }
  return headers.join("\n") + "\n";
}
