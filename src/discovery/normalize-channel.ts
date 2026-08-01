import fs from "node:fs";
import yaml from "yaml";
import { CHANNELS_YML_FILE } from "../config.js";
import type { CountryCode } from "../types.js";

export interface PredefinedChannel {
  id: string;
  name: string;
  country: CountryCode;
  category: string;
  officialPage?: string;
  aliases?: Array<string | number>;
  enabled: boolean;
}

let predefinedChannels: PredefinedChannel[] = [];
try {
  if (fs.existsSync(CHANNELS_YML_FILE)) {
    const content = fs.readFileSync(CHANNELS_YML_FILE, "utf8");
    const parsed = yaml.parse(content);
    predefinedChannels = parsed?.channels || [];
  }
} catch (err) {
  console.error("Failed to load channels.yml", err);
}

export function normalizeDisplayName(rawName: string | number): string {
  return String(rawName)
    .replace(/\s+/g, " ")
    .replace(/\s*(Canlı izle|Canlı İzle|HD izle|Kesintisiz izle|Canlı Yayın)\s*/giu, " ")
    .replace(/\s*(\|\s*Canlitv\.com|- Canlitv\.com)\s*/giu, " ")
    .replace(/Bakü/giu, "Baku")
    .replace(/Xezer/giu, "Xəzər")
    .replace(/Ictimai/giu, "İctimai")
    .replace(/Medeniyet/giu, "Mədəniyyət")
    .replace(/Medeniyyet/giu, "Mədəniyyət")
    .replace(/Dunya/giu, "Dünya")
    .replace(/Idman/giu, "İdman")
    .trim();
}

export function cleanName(name: string | number): string {
  return normalizeDisplayName(name).trim().replace(/\s+/g, " ").toLocaleLowerCase("tr");
}

export function findPredefinedChannel(rawName: string | number): PredefinedChannel | undefined {
  const cleaned = cleanName(rawName);
  return predefinedChannels.find((ch) => {
    if (cleanName(ch.name) === cleaned) return true;
    if (ch.id.toLocaleLowerCase("tr") === cleaned) return true;
    return ch.aliases?.some((alias) => cleanName(alias) === cleaned) ?? false;
  });
}

export interface NormalizedChannel {
  id: string;
  name: string;
  country: CountryCode;
  category: string;
}

export function normalizeChannel(rawName: string | number, fallbackCountry?: CountryCode): NormalizedChannel {
  const predefined = findPredefinedChannel(rawName);
  if (predefined) {
    return {
      id: predefined.id,
      name: String(predefined.name),
      country: predefined.country,
      category: predefined.category
    };
  }

  const name = normalizeDisplayName(rawName);
  const id = name
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ə/g, "e")
    .replace(/[^a-zа-яё0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "");

  return {
    id: id || "unknown-channel",
    name,
    country: fallbackCountry ?? inferCountry(name),
    category: "general"
  };
}

function inferCountry(name: string): CountryCode {
  const lower = name.toLocaleLowerCase("tr");
  if (
    lower.includes("azərbaycan") ||
    lower.includes("az tv") ||
    lower.includes("aztv") ||
    lower.includes("arb") ||
    lower.includes("xəzər") ||
    lower.includes("xezer") ||
    lower.includes("baku") ||
    lower.includes("bakü") ||
    lower.includes("cbc") ||
    lower.includes("ictimai") ||
    lower.includes("idman") ||
    lower.includes("medeniyet") ||
    lower.includes("mədəniyyət")
  ) {
    return "AZ";
  }
  if (
    lower.includes("trt") ||
    lower.includes("kanal") ||
    lower.includes("haber") ||
    lower.includes("türk") ||
    lower.includes("turk") ||
    lower.includes("show tv") ||
    lower.includes("star tv") ||
    lower.includes("now tv") ||
    lower.includes("beyaz tv")
  ) {
    return "TR";
  }
  if (/[а-яё]/iu.test(name)) return "RU";
  return "OTHER";
}

export function getPredefinedChannels(): PredefinedChannel[] {
  return predefinedChannels;
}
