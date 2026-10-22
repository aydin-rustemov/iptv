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

  return false;
}
