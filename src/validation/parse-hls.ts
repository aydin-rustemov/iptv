import m3u8Parser from "m3u8-parser";

export interface M3uEntry {
  name: string;
  url: string;
  tvgId?: string;
  tvgName?: string;
  groupTitle?: string;
  country?: string;
}

export function parseChannelM3u(content: string): M3uEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: M3uEntry[] = [];
  let currentEntry: Partial<M3uEntry> | null = null;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      currentEntry = {};
      const infPart = line.substring(8);
      
      const commaIndex = infPart.lastIndexOf(",");
      let attrText = infPart;
      let displayName = "";
      if (commaIndex !== -1) {
        attrText = infPart.substring(0, commaIndex);
        displayName = infPart.substring(commaIndex + 1).trim();
      }

      currentEntry.name = displayName;

      const attrRegex = /([\w-]+)=(?:"([^"]*)"|([^\s]*))/g;
      let match;
      while ((match = attrRegex.exec(attrText)) !== null) {
        const key = match[1]?.toLowerCase();
        const val = match[2] ?? match[3] ?? "";
        if (key === "tvg-id") currentEntry.tvgId = val;
        else if (key === "tvg-name") currentEntry.tvgName = val;
        else if (key === "group-title") currentEntry.groupTitle = val;
        else if (key === "tvg-country") currentEntry.country = val;
      }
    } else if (line.startsWith("#")) {
      continue;
    } else {
      if (currentEntry) {
        currentEntry.url = line;
        if (!currentEntry.name) {
          try {
            const urlObj = new URL(line);
            const pathname = urlObj.pathname;
            const filename = pathname.substring(pathname.lastIndexOf("/") + 1);
            currentEntry.name = filename || "Unknown Channel";
          } catch {
            currentEntry.name = "Unknown Channel";
          }
        }
        entries.push(currentEntry as M3uEntry);
        currentEntry = null;
      }
    }
  }
  return entries;
}

export interface HlsManifestInfo {
  isMaster: boolean;
  variants: Array<{
    url: string;
    bandwidth?: number;
    width?: number;
    height?: number;
    codecs?: string;
    audioGroupId?: string;
  }>;
  audioRenditions: Array<{
    groupId: string;
    name?: string;
    url?: string;
  }>;
  segments: Array<{
    url: string;
    duration: number;
  }>;
  mapUrl?: string;
}

export function parseHlsManifest(manifestText: string, baseUrl: string): HlsManifestInfo {
  const parser = new m3u8Parser.Parser();
  parser.push(manifestText);
  parser.end();

  const manifest = parser.manifest;
  const isMaster = !!(manifest.playlists && manifest.playlists.length > 0);

  const variants: HlsManifestInfo["variants"] = [];
  const audioRenditions: HlsManifestInfo["audioRenditions"] = [];
  const segments: HlsManifestInfo["segments"] = [];
  let mapUrl: string | undefined;

  if (isMaster && manifest.playlists) {
    for (const playlist of manifest.playlists) {
      const resolvedUrl = new URL(playlist.uri, baseUrl).toString();
      const resolution = playlist.attributes?.RESOLUTION;
      variants.push({
        url: resolvedUrl,
        bandwidth: playlist.attributes?.BANDWIDTH,
        width: resolution?.width,
        height: resolution?.height,
        codecs: playlist.attributes?.CODECS,
        audioGroupId: playlist.attributes?.AUDIO
      });
    }
    const mediaRegex = /#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*/gi;
    for (const match of manifestText.matchAll(mediaRegex)) {
      const line = match[0];
      const groupId = getQuotedAttribute(line, "GROUP-ID");
      if (!groupId) continue;
      const uri = getQuotedAttribute(line, "URI");
      audioRenditions.push({
        groupId,
        name: getQuotedAttribute(line, "NAME"),
        url: uri ? new URL(uri, baseUrl).toString() : undefined
      });
    }
  } else if (manifest.segments) {
    const mapUri = getQuotedAttribute(manifestText.match(/#EXT-X-MAP:[^\n]*/i)?.[0] ?? "", "URI");
    if (mapUri) {
      mapUrl = new URL(mapUri, baseUrl).toString();
    }
    for (const segment of manifest.segments) {
      const resolvedUrl = new URL(segment.uri, baseUrl).toString();
      segments.push({
        url: resolvedUrl,
        duration: segment.duration
      });
    }
  }

  return {
    isMaster,
    variants,
    audioRenditions,
    segments,
    mapUrl
  };
}

function getQuotedAttribute(line: string, attribute: string): string | undefined {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = line.match(new RegExp(`${escaped}="([^"]+)"`, "i"));
  return match?.[1];
}
