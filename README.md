# IPTV Playlist

> **2026-10-23 — source capture mode, as explicitly requested:** The 12 Azerbaijani TV identities and their order remain fixed. The normal playlist is built from M3U8 URLs actually embedded in the user's latest websites, [iCanlive](https://icanlive.tv/kategori/399/azerbaijan-tv-kanallari.html) and [OperativMM](https://operativmm.az/az/canli-tv), **without probing HLS/ffprobe/actual playback**. **Yoda is excluded entirely.** GitHub's browsing IP currently gets HTTP 403 from OperativMM, and iCanlive only supplies direct HLS for AzTV, ATV Azərbaycan and Baku TV among the requested 12. The other nine stay in [the permanent 12-slot dashboard](output/azerbaijan-fixed.html), NOT padded with guessed URLs or another broadcaster. Read [source status](output/recent-site-status.json) for per-channel reasons. The [M3U](output/azerbaijan-fixed.m3u) and [main playlist](output/playlist.m3u) contain only genuine discovered direct M3U8 URLs, not the site's HTML/player pages. **Video and Azerbaijan-IP playback are intentionally unverified.** The source capture workflow refreshes every three hours, with old ffprobe-based fixed12 job replaced.


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
