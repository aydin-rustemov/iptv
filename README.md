# IPTV Local Resolver Gateway

This project publishes a direct official-source IPTV playlist. The TV connects from the GitHub-hosted M3U directly to broadcaster media URLs; no local Node.js gateway is required for normal viewing.

## Start

```powershell
npm install
npm run direct:update
```

## Operational playlist

```text
output/playlist-direct.m3u
```

## GitHub playlist

```text
https://raw.githubusercontent.com/aydin-rustemov/iptv/main/output/playlist-direct.m3u
```

Use `output/playlist-direct.m3u`. No local server is required.

Legacy local-gateway playlists are archived for comparison only and are not operational TV playlists.
