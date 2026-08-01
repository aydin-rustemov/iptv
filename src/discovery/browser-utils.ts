import dns from "node:dns/promises";
import net from "node:net";
import { chromium } from "playwright";
import type { Browser, BrowserContext } from "playwright";
import { isPrivateIp } from "../validation/validate-url.js";

export async function checkPlaywrightInstalled(): Promise<boolean> {
  try {
    const browser = await chromium.launch();
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

export async function createSafeContext(
  browser: Browser,
  allowedDomains: string[]
): Promise<BrowserContext> {
  const context = await browser.newContext({
    serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 }
  });

  // Enable request interception for safety controls
  await context.route("**/*", async (route, request) => {
    const urlString = request.url();
    try {
      const url = new URL(urlString);
      const proto = url.protocol.toLowerCase();

      // 1. Accept only http: and https:
      if (proto !== "http:" && proto !== "https:") {
        await route.abort("blockedbyclient");
        return;
      }

      // 2. Reject localhost
      const hostname = url.hostname.toLowerCase();
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
        await route.abort("blockedbyclient");
        return;
      }

      // 3. Resolve DNS & Reject private IPs to prevent SSRF within Playwright
      let ip = "";
      if (net.isIP(url.hostname)) {
        ip = url.hostname;
      } else {
        try {
          const lookup = await dns.lookup(url.hostname);
          ip = lookup.address;
        } catch {
          await route.abort("name_not_resolved");
          return;
        }
      }

      if (isPrivateIp(ip)) {
        await route.abort("blockedbyclient");
        return;
      }

      // 4. Restrict main frame page navigation to allowed domains
      if (request.isNavigationRequest() && request.frame() === route.request().frame()) {
        const isAllowed = allowedDomains.some(
          (domain) => hostname === domain || hostname.endsWith("." + domain)
        );
        if (!isAllowed) {
          await route.abort("blockedbyclient");
          return;
        }
      }

      // 5. Abort unrelated assets/analytics/ads to save bandwidth and memory
      const resourceType = request.resourceType();
      if (["image", "font"].includes(resourceType)) {
        await route.abort("blockedbyclient");
        return;
      }

      const urlLower = urlString.toLowerCase();
      if (
        urlLower.includes("google-analytics") ||
        urlLower.includes("doubleclick") ||
        urlLower.includes("adservice") ||
        urlLower.includes("adnxs") ||
        urlLower.includes("ads") ||
        urlLower.includes("analytics") ||
        urlLower.includes("tracking")
      ) {
        await route.abort("blockedbyclient");
        return;
      }

      await route.continue();
    } catch {
      await route.abort("failed");
    }
  });

  return context;
}
