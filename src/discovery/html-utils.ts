import * as cheerio from "cheerio";

export function extractAnchors(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  try {
    const $ = cheerio.load(html);
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        try {
          const absoluteUrl = new URL(href, baseUrl).toString();
          if (!urls.includes(absoluteUrl)) {
            urls.push(absoluteUrl);
          }
        } catch {
          // Ignore malformed URLs
        }
      }
    });
  } catch {
    // Ignore html parse errors
  }
  return urls;
}

export function findM3u8InHtml(html: string): string | null {
  const m3u8Regex = /(https?:\/\/[^"'\s>\n]+\.m3u8[^"'\s>]*)/i;
  const match = html.match(m3u8Regex);
  return match && match[1] ? match[1] : null;
}
