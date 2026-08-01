# IPTV Local Resolver Gateway

This project resolves configured official television sources at runtime and exposes them through a local IPTV gateway.

## Start

```powershell
npm install
npm run serve
```

## Local playlist

```text
http://192.168.1.67:8787/playlist-working.m3u
```

## GitHub playlist

```text
https://raw.githubusercontent.com/aydin-rustemov/iptv/main/output/playlist-working.m3u
```

The computer running the gateway must remain powered on, `npm run serve` must remain running, and the TV must be able to access `192.168.1.67` on the local network.

GitHub hosts only the M3U playlist. Actual channel media is delivered by the local gateway.
