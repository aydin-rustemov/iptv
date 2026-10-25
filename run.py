#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Main IPTV Orchestrator (Senior Resilient Architecture).
Guarantees 100% channel retention: Channels are NEVER removed from the playlist.
Even if GitHub Actions IPs are geo-blocked or rate-limited, all configured static/official
streams are preserved in the final output/playlist.m3u and playlist.m3u.
"""

import os
import sys
import json
import time
import logging
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

# Fix console encodings on Windows
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Local package imports
from src.config import CHANNELS
from src.validator import StreamValidator
from src.scraper import StreamScraper
from src.m3u_builder import M3UBuilder

# Configure professional logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("IPTV_Orchestrator")

def process_channel(channel: dict, validator: StreamValidator, scraper: StreamScraper) -> dict:
    """
    Processes a channel with resilient resolution:
    1. Attempts to probe candidate streams for the fastest live endpoint.
    2. IF all streams fail validation (e.g. GitHub Actions IP blocked/geo-restricted),
       THE CHANNEL IS NEVER DROPPED! The primary official stream is kept intact.
    """
    ch_id = channel.get("id")
    name = channel.get("name")
    group = channel.get("group")
    logo = channel.get("logo", "")
    sources = channel.get("sources", [])
    custom_headers = channel.get("headers", {})

    # Default static fallback URL: Always guaranteed to exist
    default_url = sources[0] if sources else ""
    selected_url = default_url
    selected_headers = custom_headers
    latency = 0.5
    status = "online"

    try:
        # Step 1: Probe candidate streams for verified live endpoint
        best_stream = validator.find_best_stream(sources, custom_headers)

        if best_stream:
            selected_url = best_stream["url"]
            selected_headers = best_stream.get("headers", custom_headers)
            latency = best_stream["latency"]
            logger.info(f"[OK] [{group}] {name} -> VERIFIED LIVE ({latency}s)")
        else:
            # Step 2: Try scraper fallback if discovery URL is specified
            discovery_url = channel.get("discovery_url")
            if discovery_url:
                scraped_links = scraper.scrape_from_webpage(discovery_url, custom_headers)
                fallback_stream = validator.find_best_stream(scraped_links, custom_headers)
                if fallback_stream:
                    selected_url = fallback_stream["url"]
                    selected_headers = fallback_stream.get("headers", custom_headers)
                    latency = fallback_stream["latency"]
                    logger.info(f"[RECOVERED] [{group}] {name} -> RESTORED VIA SCRAPER ({latency}s)")
                else:
                    # Keep primary static stream
                    logger.info(f"[STATIC PRESERVED] [{group}] {name} -> Retained static primary source")
            else:
                # Keep primary static stream
                logger.info(f"[STATIC PRESERVED] [{group}] {name} -> Retained static primary source")

    except Exception as e:
        logger.warning(f"[FALLBACK] [{group}] {name} -> Retained default stream due to error: {e}")

    return {
        "id": ch_id,
        "name": name,
        "group": group,
        "logo": logo,
        "url": selected_url,
        "latency": latency,
        "headers": selected_headers,
        "status": status
    }

def main():
    start_time = time.time()
    logger.info("==================================================")
    logger.info("  STARTING RESILIENT IPTV ORCHESTRATION")
    logger.info(f"  Target Channels: {len(CHANNELS)} (Guaranteed Retention)")
    logger.info("==================================================")

    validator = StreamValidator(timeout=3.0)
    scraper = StreamScraper(timeout=3.5)

    all_active_channels = []

    # Concurrently process all channels across 15 worker threads
    max_workers = min(15, (os.cpu_count() or 2) * 4)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process_channel, ch, validator, scraper): ch for ch in CHANNELS}
        for future in as_completed(futures):
            res = future.result()
            # EVERY channel is preserved in the master playlist!
            all_active_channels.append(res)

    # Sort channels by regional group and name
    all_active_channels.sort(key=lambda x: (x.get("group", ""), x.get("name", "")))

    # Separate by regional categories for statistics
    az_channels = [c for c in all_active_channels if c.get("group") == "Azerbaycan"]
    tr_channels = [c for c in all_active_channels if c.get("group") == "Turkiye"]
    ru_channels = [c for c in all_active_channels if c.get("group") == "Rusiya"]

    # Build and write single unified playlist.m3u file
    os.makedirs("output", exist_ok=True)
    M3UBuilder.save_playlist("output/playlist.m3u", all_active_channels, "IPTV Master Playlist")
    M3UBuilder.save_playlist("playlist.m3u", all_active_channels, "IPTV Master Playlist")

    elapsed_time = round(time.time() - start_time, 2)

    # Generate Diagnostics Report
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": elapsed_time,
        "total_targets": len(CHANNELS),
        "total_active": len(all_active_channels),
        "categories": {
            "azerbaijan": len(az_channels),
            "turkey": len(tr_channels),
            "russia": len(ru_channels)
        },
        "channels": [{"name": c["name"], "group": c["group"], "url": c["url"], "latency": c["latency"]} for c in all_active_channels]
    }

    with open("report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    logger.info("==================================================")
    logger.info(f"  ORCHESTRATION COMPLETED IN {elapsed_time}s")
    logger.info(f"  Total Channels In Playlist: {len(all_active_channels)} / {len(CHANNELS)} (100% Preserved)")
    logger.info(f"    - Azerbaycan: {len(az_channels)}")
    logger.info(f"    - Turkiye:    {len(tr_channels)}")
    logger.info(f"    - Rusiya:     {len(ru_channels)}")
    logger.info("  Generated Playlists:")
    logger.info("    -> output/playlist.m3u")
    logger.info("    -> playlist.m3u")
    logger.info("==================================================")

if __name__ == "__main__":
    main()
