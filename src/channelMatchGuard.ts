import type { PlaylistEntry } from "./types.js";

// A technically playable manifest is not evidence that it belongs to the
// requested channel. Prevent known misleading aggregator metadata from
// masquerading as ARB, Space or another TV station.
export function isMismatchedChannel(entry: PlaylistEntry): boolean {
  const name = (entry.name + " " + (entry.tvgName ?? "")).toLocaleLowerCase("tr");
  const url = entry.url.toLocaleLowerCase("tr");

  // Site titles are not channel names. Dedicated channel selection adapters
  // emit the actual label instead.
  if (/tvstream\s*[—–-]|tvstream\.az|canlı tv izle|canli tv izle|canlitv\.com|yoda\.az\s*[-–—]/i.test(name)) {
    return true;
  }

  // In the previous production output "ARB" pointed to arbgunes.stream.
  // ARB Günəş is a separate station, so never alias it to the main ARB TV.
  const isArbMain = entry.priorityId === "arb" ||
    /^arb(?:\s+tv)?$/i.test((entry.name ?? "").trim());
  if (isArbMain && /arb[-_]?gunes|arbgunes|arb[-_]?güneş|arbgünəş/i.test(url)) {
    return true;
  }

  // Prevent a technically working but WRONG TV station being relabeled as a
  // priority Turkish broadcaster. Checked against full host/path, not query.
  const broadcastId = entry.priorityId;
  const destination = (() => {
    try { const parsed = new URL(entry.url); return (parsed.hostname + parsed.pathname).toLowerCase(); }
    catch { return entry.url.toLowerCase().split("?")[0]!; }
  })();
  if (broadcastId === "atv-tr" && /alanya|alanyatv|atv\.az|azad|arb|arbgunes|antalyatv|\bazstar\b/.test(destination)) return true;
  if (broadcastId === "show-tv" && /showplus|showmax|alanya|showhaber/.test(destination)) return true;
  if (broadcastId === "star-tv" && /azstar|startvaz|starhaber|starspor|star-kibris|starkibris/.test(destination)) return true;
  if (broadcastId === "kanal-d" && /kanal(?:1[2-9]|[2-9]\d?)|kanald(?:iyarbakir|ogus)|kanal7|eurod/.test(destination)) return true;
  if (broadcastId === "now-tv" && /foxnews|foxlife|foxsports|nowhaber/.test(destination)) return true;
  if (broadcastId === "tv8" && /tv8[.\-_]?5|tv85|tv8plus/.test(destination)) return true;
  if (broadcastId === "trt-1" && /trt(?:2|3|haber|spor|belgesel|world|muzik|çocuk|cocuk)/.test(destination)) return true;
  return false;
}
