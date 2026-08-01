import { resolveAndCheckUrl } from "./validate-url.js";
import type { SegmentSampleInfo } from "../types.js";

export interface MediaSampleResult {
  body: Buffer;
  finalUrl: string;
  info: SegmentSampleInfo;
}

export async function downloadBoundedMediaSample(
  urlString: string,
  options: { timeoutMs: number; maxBytes: number; headers?: Record<string, string> }
): Promise<MediaSampleResult> {
  let currentUrl = urlString;
  let redirectCount = 0;
  const maxRedirects = 5;

  while (redirectCount <= maxRedirects) {
    const { url } = await resolveAndCheckUrl(currentUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Range: `bytes=0-${Math.max(0, options.maxBytes - 1)}`,
      ...options.headers
    };

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "manual"
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`Segment redirect ${response.status} without location header`);
        currentUrl = new URL(location, url.toString()).toString();
        redirectCount++;
        clearTimeout(timeoutId);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Segment HTTP error ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        return {
          body: Buffer.alloc(0),
          finalUrl: url.toString(),
          info: {
            contentLength: parseContentLength(response.headers.get("content-length")),
            rangeRequested: true,
            rangeSupported: response.status === 206,
            bytesRead: 0,
            intentionallyTruncated: false
          }
        };
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let intentionallyTruncated = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          const remaining = options.maxBytes - totalBytes;
          if (remaining <= 0) {
            intentionallyTruncated = true;
            await reader.cancel();
            break;
          }
          if (value.length > remaining) {
            chunks.push(value.slice(0, remaining));
            totalBytes += remaining;
            intentionallyTruncated = true;
            await reader.cancel();
            break;
          }
          chunks.push(value);
          totalBytes += value.length;
        }
      } finally {
        reader.releaseLock();
      }

      clearTimeout(timeoutId);
      const body = alignTransportStreamSample(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));

      return {
        body,
        finalUrl: url.toString(),
        info: {
          contentLength: parseContentLength(response.headers.get("content-length")),
          rangeRequested: true,
          rangeSupported: response.status === 206,
          bytesRead: body.length,
          intentionallyTruncated
        }
      };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  throw new Error(`Too many segment redirects (max: ${maxRedirects})`);
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function alignTransportStreamSample(body: Buffer): Buffer {
  if (body.length < 188 || body[0] !== 0x47) return Buffer.from(body);
  const alignedLength = body.length - (body.length % 188);
  return alignedLength > 0 ? Buffer.from(body.subarray(0, alignedLength)) : Buffer.from(body);
}
