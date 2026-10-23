# IPTV Playlist

> **2026-10-23 — fixed 12-channel Azerbaijan mode (NO YODA).** The 12 broadcaster identities are held in permanent user-specified order in [config/az-fixed12.json](config/az-fixed12.json): AzTV, İctimai TV, İdman TV, Mədəniyyət TV, Xəzər TV, ATV Azərbaycan, ARB, Space TV, CBC Sport, Real TV, ARB 24, Baku TV. Each has multiple *non-Yoda* candidate HLS URLs. The [fixed status report](output/az-fixed12-status.json) and [12-slot channel dashboard](output/azerbaijan-fixed.html) keep all station names regardless of availability. The [M3U playlist](output/azerbaijan-fixed.m3u) and main `output/playlist.m3u` include ONLY those whose HLS manifest, actual video segment and repeat manifest passed a GitHub Actions test; no channel swaps or non-working placeholders. The `Fixed 12 Azerbaijan IPTV Monitor` workflow checks every 3 hours. **GitHub checks do not guarantee AZ-device playback nor prove the pictured broadcaster**; geo-restricted streams may be unavailable until an Azerbaijan-side validator/authorized provider is present. Previously broken static Yoda links are excluded entirely.


This project downloads publicly available IPTV stream candidates, validates actual media playback and publishes up to 100 region-focused channels after checking for actual video packets (Azerbaijan first, then Turkey and Russia).

No local server is required. The user's computer may be turned off. The playlist is rebuilt from fresh AZ, TR and RU source playlists by GitHub Actions on a three-hour UTC cron (scheduling can be delayed by GitHub). The former scheduled publisher is paused while restoring real stream availability. GitHub server checks do not guarantee playback in Azerbaijan or on every TV app. Expiring signed links, provider geo-restrictions and browser-only playback can still prevent channels from playing.

## TV Link

```text
https://raw.githubusercontent.com/aydin-rustemov/iptv/main/output/playlist.m3u
```

Streams originate from public upstream indexes and remain subject to availability and rights held by their respective owners.

## Local Update

```powershell
npm install
npm run update
npm run audit
```

The publisher rejects oversized or soon-expiring links, removes overly large artwork, limits the output to 8 MiB, and preserves the existing playlist when generation fails. `npm test` runs regression tests; `npm run audit` checks the generated playlist.

## Important limitations

The GitHub runner verifies whether a video stream is reachable from its own region, **not** from an Azerbaijani home network. Azerbaijan-only geo-restricted streams may be excluded even if they work in Baku. No unverified channel is inserted merely to reach the 100-channel target. Current release has 7 GitHub-video-tested channels, while 36 candidates and their failures are recorded in the [GitHub Actions probe](https://github.com/aydin-rustemov/iptv/actions/runs/39985497737). In the IPTV player, refresh or remove and add the same TV Link to clear any cached older 79 MB playlist.
