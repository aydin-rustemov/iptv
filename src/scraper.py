#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Dynamic stream harvester and fallback scraper.
Collects fresh HLS streams from web pages and community mirror endpoints.
"""

import re
import requests
import urllib3
from typing import List, Dict, Optional
from src.config import DEFAULT_HEADERS

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

class StreamScraper:
    def __init__(self, timeout: float = 5.0):
        self.timeout = timeout
        self.session = requests.Session()

    def scrape_from_webpage(self, page_url: str, custom_headers: Optional[Dict[str, str]] = None) -> List[str]:
        """
        Extracts all .m3u8 stream links embedded in a target webpage HTML / JavaScript source.
        """
        headers = DEFAULT_HEADERS.copy()
        if custom_headers:
            headers.update(custom_headers)

        found_streams = []
        try:
            resp = self.session.get(page_url, headers=headers, timeout=self.timeout, verify=False)
            if resp.status_code == 200:
                html = resp.text
                
                # Standard m3u8 regex pattern
                pattern = r'(https?://[^\s"\'<>]+\.m3u8[^\s"\'<>]*)'
                matches = re.findall(pattern, html)
                for m in matches:
                    clean_url = m.strip().replace('\\', '')
                    if clean_url not in found_streams:
                        found_streams.append(clean_url)
        except Exception:
            pass

        return found_streams

    def fetch_upstream_m3u_index(self, index_url: str) -> Dict[str, str]:
        """
        Parses an upstream M3U file into a dictionary of {channel_name: stream_url}.
        """
        channel_map = {}
        try:
            resp = self.session.get(index_url, headers=DEFAULT_HEADERS, timeout=self.timeout, verify=False)
            if resp.status_code == 200:
                current_title = ""
                for line in resp.text.splitlines():
                    line = line.strip()
                    if line.startswith("#EXTINF:"):
                        current_title = line.split(",")[-1].strip().lower()
                    elif line.startswith("http") and current_title:
                        channel_map[current_title] = line
                        current_title = ""
        except Exception:
            pass

        return channel_map
