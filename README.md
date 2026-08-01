# IPTV Playlist

This project downloads publicly available IPTV stream candidates, validates actual media playback and publishes up to 300 working channels.

No local server is required. The user's computer may be turned off. The playlist is updated automatically every three hours.

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
