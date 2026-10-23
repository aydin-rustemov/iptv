# IPTV Playlist

> **2026-10-23 Quality-only release.** Previous `output/playlist.m3u` contained 100 unverified or broken streams and the user reported zero working. Archived as [playlist.unverified-archive.m3u](output/playlist.unverified-archive.m3u). The **current** main `output/playlist.m3u` contains **only 7 Azerbaijani channels** with HLS manifest + real video-segment verification + another manifest request on GitHub Actions ([run #39985497737](https://github.com/aydin-rustemov/iptv/actions/runs/39985497737)). **This does NOT prove playback from an Azerbaijani IP or a particular IPTV app, nor prove broadcaster visuals.** ARB, Real, İctimai, Xəzər, Space and Mədəniyyət all failed the external verification (mostly 403/404), so are intentionally excluded rather than published as broken. The alternative tokenized-Yoda approach also failed on the user's device. Automatic publishing stays paused; experimental [same-AZ-IP gateway](docs/az-local-gateway.md) is not installed and cannot magically run from GitHub.


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
