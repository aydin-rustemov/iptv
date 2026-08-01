import { resolveAndCheckUrl } from "./validate-url.js";

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  limitBytes?: number;
  rejectHtml?: boolean;
}

export interface FetchResult {
  body: Buffer;
  headers: Headers;
  finalUrl: string;
}

export async function fetchSafe(
  urlString: string,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ...options.headers
  };

  let currentUrl = urlString;
  let redirectCount = 0;
  const maxRedirects = 5;

  while (redirectCount <= maxRedirects) {
    const { url } = await resolveAndCheckUrl(currentUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "manual"
      });

      clearTimeout(timeoutId);

      const status = response.status;
      if (status >= 300 && status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect status ${status} without location header`);
        }
        currentUrl = new URL(location, url.toString()).toString();
        redirectCount++;
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP Error ${status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (options.rejectHtml !== false && (
        contentType.includes("text/html") ||
        contentType.includes("application/xhtml+xml")
      )) {
        throw new Error(`Expected manifest/media, but received HTML (Content-Type: ${contentType})`);
      }

      if (!response.body) {
        return {
          body: Buffer.alloc(0),
          headers: response.headers,
          finalUrl: url.toString()
        };
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxSizeBytes = options.limitBytes ?? 10 * 1024 * 1024; // Default 10MB limit

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.length;
            if (totalBytes > maxSizeBytes) {
              controller.abort();
              throw new Error(`Response size limit exceeded (${maxSizeBytes} bytes)`);
            }
            chunks.push(value);
          }
        }
      } finally {
        reader.releaseLock();
      }

      const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      return {
        body: buffer,
        headers: response.headers,
        finalUrl: url.toString()
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const causeCode = err?.cause?.code ? ` (${err.cause.code})` : "";
      throw new Error(`${err?.message ?? "fetch failed"}${causeCode}`);
    }
  }

  throw new Error(`Too many redirects (max: ${maxRedirects})`);
}

export async function fetchTextSafe(
  urlString: string,
  options: FetchOptions = {}
): Promise<{ text: string; headers: Headers; finalUrl: string }> {
  const result = await fetchSafe(urlString, {
    ...options,
    rejectHtml: false
  });
  return {
    text: result.body.toString("utf8"),
    headers: result.headers,
    finalUrl: result.finalUrl
  };
}
