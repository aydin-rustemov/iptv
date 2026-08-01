import type { Page, Request, Response } from "playwright";

export interface CapturedRequest {
  url: string;
  resourceType: string;
  contentType?: string;
  playbackHeaders: {
    userAgent?: string;
    referer?: string;
    origin?: string;
  };
  headersPresent: {
    cookie: boolean;
    authorization: boolean;
    referer: boolean;
    origin: boolean;
    customHeaders: string[];
  };
}

export async function captureMediaRequests(
  page: Page,
  action: () => Promise<void>
): Promise<CapturedRequest[]> {
  const captured: CapturedRequest[] = [];

  const handleRequest = (request: Request) => {
    const url = request.url();
    const urlLower = url.toLowerCase();
    const resourceType = request.resourceType();

    const isMedia =
      resourceType === "media" ||
      urlLower.includes(".m3u8") ||
      urlLower.includes(".mpd") ||
      urlLower.includes(".m3u") ||
      urlLower.includes(".ts") ||
      urlLower.includes(".m4s");

    if (isMedia) {
      const headers = request.headers();
      const headerNames = Object.keys(headers).map((h) => h.toLowerCase());

      const hasCookie = headerNames.includes("cookie");
      const hasAuth = headerNames.includes("authorization");
      const hasReferer = headerNames.includes("referer");
      const hasOrigin = headerNames.includes("origin");

      const standardHeaders = [
        "user-agent",
        "accept",
        "accept-encoding",
        "accept-language",
        "connection",
        "host",
        "referer",
        "origin",
        "cookie",
        "authorization",
        "range",
        "sec-ch-ua",
        "sec-ch-ua-mobile",
        "sec-ch-ua-platform",
        "sec-fetch-dest",
        "sec-fetch-mode",
        "sec-fetch-site",
        "sec-fetch-user",
        "upgrade-insecure-requests",
        "content-length",
        "content-type"
      ];
      const customHeaders = headerNames.filter((h) => !standardHeaders.includes(h));
      const requiredHeaderNames = [
        ...(hasCookie ? ["cookie"] : []),
        ...(hasAuth ? ["authorization"] : []),
        ...(hasReferer ? ["referer"] : []),
        ...(hasOrigin ? ["origin"] : []),
        ...customHeaders
      ];

      // Avoid duplicates in the same capture run
      if (!captured.some((c) => c.url === url)) {
        captured.push({
          url,
          resourceType,
          playbackHeaders: {
            userAgent: headers["user-agent"],
            referer: headers["referer"],
            origin: headers["origin"]
          },
          headersPresent: {
            cookie: hasCookie,
            authorization: hasAuth,
            referer: hasReferer,
            origin: hasOrigin,
            customHeaders: requiredHeaderNames
          }
        });
      }
    }
  };

  const handleResponse = (response: Response) => {
    const url = response.url();
    const contentType = response.headers()["content-type"];
    const match = captured.find((c) => c.url === url);
    if (match && contentType) {
      match.contentType = contentType;
    }
  };

  page.on("request", handleRequest);
  page.on("response", handleResponse);

  try {
    await action();
  } finally {
    page.off("request", handleRequest);
    page.off("response", handleResponse);
  }

  return captured;
}
