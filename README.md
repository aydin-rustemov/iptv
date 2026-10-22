# IPTV Playlist

This project downloads publicly available IPTV stream candidates, validates actual media playback and publishes up to 300 working channels.

No local server is required. The user's computer may be turned off. The playlist is refreshed by GitHub Actions on a three-hour UTC cron (scheduling can be delayed by GitHub). The job publishes only streams that passed the runner's checks; this does not guarantee playback in every country or TV app. Expiring signed links, provider geo-restrictions and browser-only playback can still prevent channels from playing.

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
