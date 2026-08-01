import dns from "node:dns/promises";
import net from "node:net";

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true; // Treat invalid as unsafe
    }
    const [p0, p1] = parts as [number, number, number, number];
    if (p0 === 127) return true; // Loopback
    if (p0 === 10) return true; // Class A private
    if (p0 === 172 && p1 >= 16 && p1 <= 31) return true; // Class B private
    if (p0 === 192 && p1 === 168) return true; // Class C private
    if (p0 === 169 && p1 === 254) return true; // Link-local
    if (p0 === 0) return true; // Local/Broadcast
    if (p0 >= 224) return true; // Multicast & Reserved
    return false;
  } else if (net.isIPv6(ip)) {
    const clean = ip.toLowerCase().trim();
    if (
      clean === "::1" ||
      clean === "::" ||
      clean === "0:0:0:0:0:0:0:1" ||
      clean === "0:0:0:0:0:0:0:0"
    ) {
      return true;
    }
    // link-local: fe80::/10 (starts with fe8, fe9, fea, feb)
    if (
      clean.startsWith("fe8") ||
      clean.startsWith("fe9") ||
      clean.startsWith("fea") ||
      clean.startsWith("feb")
    ) {
      return true;
    }
    // unique local: fc00::/7 (starts with fc or fd)
    if (clean.startsWith("fc") || clean.startsWith("fd")) {
      return true;
    }
    // multicast: ff00::/8
    if (clean.startsWith("ff")) {
      return true;
    }
    return false;
  }
  return true; // Treat unknown address families as unsafe
}

export async function resolveAndCheckUrl(urlString: string): Promise<{ url: URL; ip: string }> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid URL format");
  }

  const proto = url.protocol.toLowerCase();
  if (proto !== "http:" && proto !== "https:") {
    throw new Error(`Forbidden protocol: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new Error("URL contains embedded credentials");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    throw new Error("Localhost is forbidden");
  }

  // If the host is already a direct IP, skip DNS lookup and validate immediately
  if (net.isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) {
      throw new Error(`Access to private IP is forbidden: ${url.hostname}`);
    }
    return { url, ip: url.hostname };
  }

  let ip: string;
  try {
    const lookup = await dns.lookup(url.hostname);
    ip = lookup.address;
  } catch (err: any) {
    throw new Error(`DNS resolution failed for ${url.hostname}: ${err.message}`);
  }

  if (isPrivateIp(ip)) {
    throw new Error(`Access to private IP is forbidden: ${ip}`);
  }

  return { url, ip };
}
