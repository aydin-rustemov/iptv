import type { PlaylistEntry } from "./types.js";

export function parseM3u(text: string, sourceName: string): PlaylistEntry[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const entries: PlaylistEntry[] = [];
  let pending: Omit<PlaylistEntry, "url"> | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const comma = line.indexOf(",");
      const attrsText = comma >= 0 ? line.slice(0, comma) : line;
      const displayName = comma >= 0 ? line.slice(comma + 1).trim() : "";
      const attrs = parseAttributes(attrsText);
      pending = {
        sourceName,
        tvgId: attrs["tvg-id"],
        tvgName: attrs["tvg-name"],
        tvgLogo: attrs["tvg-logo"],
        groupTitle: attrs["group-title"],
        country: normalizeCountry(attrs["tvg-country"] ?? attrs["tvg-country-code"] ?? attrs["country"] ?? countryFromTvgId(attrs["tvg-id"])),
        category: normalizeCategory(attrs["group-title"]),
        name: attrs["tvg-name"] || displayName || attrs["tvg-id"] || "Unnamed",
        headers: {}
      };
      continue;
    }
    if (line.startsWith("#EXTVLCOPT:") && pending) {
      const opt = line.slice("#EXTVLCOPT:".length);
      const [key, ...valueParts] = opt.split("=");
      const value = valueParts.join("=").trim();
      if (key === "http-user-agent" && value) pending.headers["User-Agent"] = value;
      if ((key === "http-referrer" || key === "http-referer") && value) pending.headers["Referer"] = value;
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!pending) continue;
    const { url, headers } = splitUrlPipe(line);
    if (!/^https?:\/\//i.test(url)) {
      pending = undefined;
      continue;
    }
    entries.push({ ...pending, url, headers: { ...pending.headers, ...headers } });
    pending = undefined;
  }

  return entries;
}

function parseAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of text.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)) {
    attrs[match[1]!.toLowerCase()] = match[2]!;
  }
  return attrs;
}

function splitUrlPipe(value: string): { url: string; headers: Record<string, string> } {
  const [urlPart, pipe] = value.split("|", 2);
  const headers: Record<string, string> = {};
  if (pipe) {
    for (const part of pipe.split("&")) {
      const [rawKey, rawValue] = part.split("=", 2);
      if (!rawKey || !rawValue) continue;
      const key = decodeURIComponent(rawKey).toLowerCase();
      const val = decodeURIComponent(rawValue);
      if (key === "user-agent") headers["User-Agent"] = val;
      if (key === "referer" || key === "referrer") headers["Referer"] = val;
    }
  }
  return { url: (urlPart ?? "").trim(), headers };
}

export function normalizeCountry(raw?: string): string {
  const value = (raw ?? "").trim();
  const upper = value.toUpperCase();
  if (upper === "AZ" || /AZER|AZƏR|AZERBAIJAN/i.test(value)) return "Azərbaycan";
  if (upper === "TR" || /TURK|TÜRK|TURKEY/i.test(value)) return "Türkiyə";
  if (upper === "RU" || /RUSS|РОСС|RUSSIAN/i.test(value)) return "Rusiya";
  if (upper === "US" || upper.includes("USA") || /UNITED STATES/i.test(value)) return "ABŞ";
  if (upper === "NL") return "Niderland";
  if (upper === "UA") return "Ukrayna";
  if (upper === "MA") return "Mərakeş";
  if (upper === "PE") return "Peru";
  if (upper === "IT") return "İtaliya";
  if (upper === "ES") return "İspaniya";
  if (upper === "DO") return "Dominikan Respublikası";
  if (upper === "RO") return "Rumıniya";
  if (upper === "CL") return "Çili";
  if (upper === "AU") return "Avstraliya";
  if (upper === "AR") return "Argentina";
  if (upper === "DE" || /GERMANY|DEUTSCH/i.test(value)) return "Almaniya";
  if (upper === "FR" || /FRANCE/i.test(value)) return "Fransa";
  if (upper === "GB" || upper === "UK" || /UNITED KINGDOM/i.test(value)) return "Böyük Britaniya";
  return value || "Beynəlxalq";
}

export function normalizeCategory(raw?: string): string {
  const value = (raw ?? "").toLowerCase();
  if (/news|haber|xəbər|новост/i.test(value)) return "News";
  if (/sport|idman/i.test(value)) return "Sports";
  if (/doc|belgesel|documentary|sənəd/i.test(value)) return "Documentary";
  if (/kids|children|cocuk|çocuk|uşaq/i.test(value)) return "Children";
  if (/movie|film|cinema/i.test(value)) return "Movies";
  if (/music|muzik|müzik/i.test(value)) return "Music";
  if (/culture|kultur|mədəni/i.test(value)) return "Culture";
  if (/education|edu/i.test(value)) return "Education";
  if (/general/i.test(value)) return "General";
  return "Other";
}

function countryFromTvgId(tvgId?: string): string | undefined {
  const match = tvgId?.match(/\.([a-z]{2})(?:@|$)/i);
  return match?.[1]?.toUpperCase();
}
