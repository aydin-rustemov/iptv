#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Main IPTV Orchestrator.
Validates, repairs, and updates all IPTV channels every 3 hours via GitHub Actions.
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
    Validates a single channel through the tiered resolution architecture.
    Completely isolated so that an individual failure never crashes the batch.
    """
    ch_id = channel.get("id")
    name = channel.get("name")
    group = channel.get("group")
    logo = channel.get("logo", "")
    sources = channel.get("sources", [])
    custom_headers = channel.get("headers", {})

    try:
        # Step 1: Probe candidate streams for the fastest working endpoint
        best_stream = validator.find_best_stream(sources, custom_headers)

        if best_stream:
            logger.info(f"[OK] [{group}] {name} -> ACTIVE ({best_stream['latency']}s)")
            return {
                "id": ch_id,
                "name": name,
                "group": group,
                "logo": logo,
                "url": best_stream["url"],
                "latency": best_stream["latency"],
                "headers": best_stream.get("headers", {}),
                "status": "online"
            }

        # Step 2: Dynamic Fallback (if any discovery URLs provided)
        discovery_url = channel.get("discovery_url")
        if discovery_url:
            scraped_links = scraper.scrape_from_webpage(discovery_url, custom_headers)
            fallback_stream = validator.find_best_stream(scraped_links, custom_headers)
            if fallback_stream:
                logger.info(f"[RECOVERED] [{group}] {name} -> RESTORED VIA SCRAPER ({fallback_stream['latency']}s)")
                return {
                    "id": ch_id,
                    "name": name,
                    "group": group,
                    "logo": logo,
                    "url": fallback_stream["url"],
                    "latency": fallback_stream["latency"],
                    "headers": fallback_stream.get("headers", {}),
                    "status": "recovered"
                }

        logger.warning(f"[FAIL] [{group}] {name} -> OFFLINE (All {len(sources)} candidates unreachable)")
        return {
            "id": ch_id,
            "name": name,
            "group": group,
            "status": "offline"
        }

    except Exception as e:
        logger.error(f"[ERROR] Error processing {name}: {e}")
        return {
            "id": ch_id,
            "name": name,
            "group": group,
            "status": "error",
            "error": str(e)
        }

def main():
    start_time = time.time()
    logger.info("==================================================")
    logger.info("  STARTING IPTV REPAIR & UPDATE ORCHESTRATION")
    logger.info(f"  Target Channels: {len(CHANNELS)}")
    logger.info("==================================================")

    validator = StreamValidator(timeout=3.5)
    scraper = StreamScraper(timeout=4.0)

    active_channels = []
    failed_channels = []

    # Concurrently process all channels across 15 worker threads
    max_workers = min(15, (os.cpu_count() or 2) * 4)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process_channel, ch, validator, scraper): ch for ch in CHANNELS}
        for future in as_completed(futures):
            res = future.result()
            if res.get("status") in ["online", "recovered"]:
                active_channels.append(res)
            else:
                failed_channels.append(res)

    # Sort active channels by group and name for clean organization
    active_channels.sort(key=lambda x: (x.get("group", ""), x.get("name", "")))

    # Separate by regional categories
    az_channels = [c for c in active_channels if c.get("group") == "Azerbaycan"]
    tr_channels = [c for c in active_channels if c.get("group") == "Turkiye"]
    ru_channels = [c for c in active_channels if c.get("group") == "Rusiya"]

    # Build and write single unified playlist.m3u file
    M3UBuilder.save_playlist("playlist.m3u", active_channels, "IPTV Master Playlist")
    if os.path.exists("output"):
        M3UBuilder.save_playlist("output/playlist.m3u", active_channels, "IPTV Master Playlist")

    elapsed_time = round(time.time() - start_time, 2)

    # Generate Diagnostics Report
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": elapsed_time,
        "total_targets": len(CHANNELS),
        "total_active": len(active_channels),
        "total_failed": len(failed_channels),
        "categories": {
            "azerbaijan": len(az_channels),
            "turkey": len(tr_channels),
            "russia": len(ru_channels)
        },
        "active_list": [{"name": c["name"], "group": c["group"], "latency": c["latency"]} for c in active_channels],
        "failed_list": [{"name": c["name"], "group": c["group"]} for c in failed_channels]
    }

    with open("report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    logger.info("==================================================")
    logger.info(f"  ORCHESTRATION COMPLETED IN {elapsed_time}s")
    logger.info(f"  Total Verified Working: {len(active_channels)} / {len(CHANNELS)}")
    logger.info(f"    - Azerbaycan: {len(az_channels)}")
    logger.info(f"    - Turkiye:    {len(tr_channels)}")
    logger.info(f"    - Rusiya:     {len(ru_channels)}")
    logger.info("  Generated Playlist: output/playlist.m3u & playlist.m3u")
    logger.info("==================================================")

if __name__ == "__main__":
    main()
