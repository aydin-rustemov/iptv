#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
High-performance stream validator.
Probes candidate HLS streams, validates M3U8 headers/chunks, and measures latency.
"""

import time
import requests
import urllib3
from typing import Optional, Dict, Tuple
from src.config import DEFAULT_HEADERS

# Disable SSL verification warnings for legacy/self-signed TV broadcaster certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

class StreamValidator:
    def __init__(self, timeout: float = 4.0):
        self.timeout = timeout
        self.session = requests.Session()

    def validate_url(self, url: str, custom_headers: Optional[Dict[str, str]] = None) -> Tuple[bool, float, str]:
        """
        Validates if a URL is an active, reachable HLS (.m3u8) stream.
        Returns: (is_valid, latency_seconds, resolved_url)
        """
        if not url or not url.startswith("http"):
            return False, 999.0, url

        headers = DEFAULT_HEADERS.copy()
        if custom_headers:
            headers.update(custom_headers)

        start_time = time.time()
        try:
            # Stream=True allows reading only the first chunk without downloading video segments
            response = self.session.get(
                url,
                headers=headers,
                timeout=self.timeout,
                verify=False,
                stream=True,
                allow_redirects=True
            )

            latency = round(time.time() - start_time, 3)

            if response.status_code in [200, 206]:
                # Read the first 1KB of content
                chunk = next(response.iter_content(chunk_size=1024), b"")
                content = chunk.decode("utf-8", errors="ignore")
                
                # Check for standard HLS manifest signatures
                if "#EXT" in content or "#EXTM3U" in content or "#EXT-X-" in content:
                    return True, latency, response.url

            return False, latency, url

        except Exception:
            return False, 999.0, url

    def find_best_stream(self, candidate_urls: list, custom_headers: Optional[Dict[str, str]] = None) -> Optional[Dict]:
        """
        Tests multiple stream candidates sequentially or prioritized, returning the fastest working stream.
        """
        best_candidate = None
        min_latency = 999.0

        for url in candidate_urls:
            is_valid, latency, resolved_url = self.validate_url(url, custom_headers)
            if is_valid:
                if latency < min_latency:
                    min_latency = latency
                    best_candidate = {
                        "url": resolved_url,
                        "latency": latency,
                        "headers": custom_headers or {}
                    }
                # If latency is exceptionally good (< 0.8s), use it immediately
                if latency < 0.8:
                    break

        return best_candidate
