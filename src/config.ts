import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_CONFIG: AppConfig = {
  legacyDiscoveryEnabled: false,
  enabledAdapters: [
    "canlitv-com",
    "public-iptv",
    "yoda",
    "iptv-org",
    "iptv-cat"
  ],
  countries: ["AZ", "TR", "RU"],
  discoveryTimeoutMs: parseInt(process.env["DISCOVERY_TIMEOUT_MS"] || "60000", 10),
  validationTimeoutMs: parseInt(process.env["VALIDATION_TIMEOUT_MS"] || "10000", 10),
  browserTimeoutMs: parseInt(process.env["BROWSER_TIMEOUT_MS"] || "15000", 10), // User request says: Navigation timeout: 15 seconds
  concurrencyDiscovery: parseInt(process.env["CONCURRENCY_DISCOVERY"] || "2", 10), // User request: Discovery concurrency: 2
  concurrencyValidation: parseInt(process.env["CONCURRENCY_VALIDATION"] || "2", 10), // User request: Validation concurrency: 2
  maxRetries: parseInt(process.env["MAX_RETRIES"] || "2", 10), // User request: Attempts per stream: 2
  outputDir: process.env["OUTPUT_DIR"] || path.resolve(__dirname, "../output"),
  serverPort: parseInt(process.env["PORT"] || "8787", 10),
  maxCandidatesPerSource: parseInt(process.env["MAX_CANDIDATES_PER_SOURCE"] || "130", 10),
  maxTotalCandidates: parseInt(process.env["MAX_TOTAL_CANDIDATES"] || "130", 10),
  maxSourcePages: parseInt(process.env["MAX_SOURCE_PAGES"] || "100", 10),
  browserCaptureTimeMs: parseInt(process.env["BROWSER_CAPTURE_TIME_MS"] || "8000", 10),
  manifestTimeoutMs: parseInt(process.env["MANIFEST_TIMEOUT_MS"] || "10000", 10),
  segmentTimeoutMs: parseInt(process.env["SEGMENT_TIMEOUT_MS"] || "10000", 10),
  ffprobeTimeoutMs: parseInt(process.env["FFPROBE_TIMEOUT_MS"] || "12000", 10),
  segmentSampleMaxBytes: parseInt(process.env["IPTV_SEGMENT_SAMPLE_MAX_BYTES"] || String(8 * 1024 * 1024), 10),
  playerProfile: (process.env["PLAYER_PROFILE"] === "vlc" ? "vlc" : "ott-navigator")
};

export const OFFICIAL_CHANNELS_FILE = path.resolve(__dirname, "../data/official-channels.yml");
export const RESOLVER_STATUS_FILE = path.resolve(__dirname, "../output/resolver-status.json");
export const RESOLVER_STATUS_HTML_FILE = path.resolve(__dirname, "../output/resolver-status.html");

export const DATA_DIR = path.resolve(__dirname, "../data");
export const CANDIDATES_FILE = path.join(DATA_DIR, "candidates.json");
export const VALIDATION_RESULTS_FILE = path.join(DATA_DIR, "validation-results.json");
export const VALIDATION_CACHE_FILE = path.join(DATA_DIR, "validation-cache.json");
export const CHANNEL_OVERRIDES_FILE = path.join(DATA_DIR, "channel-overrides.json");
export const CHANNELS_YML_FILE = path.resolve(__dirname, "../channels.yml");
