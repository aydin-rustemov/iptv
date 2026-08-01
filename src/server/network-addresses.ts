import os from "node:os";

export function getLanAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const [name, info] of Object.entries(interfaces)) {
    if (!info) continue;
    const lowerName = name.toLowerCase();

    // Exclude common virtual/VPN interface names
    if (
      lowerName.includes("docker") ||
      lowerName.includes("vbox") ||
      lowerName.includes("virtualbox") ||
      lowerName.includes("vethernet") ||
      lowerName.includes("hyper-v") ||
      lowerName.includes("vpn") ||
      lowerName.includes("vmnet") ||
      lowerName.includes("loopback") ||
      lowerName.includes("pseudo")
    ) {
      continue;
    }

    for (const addr of info) {
      if (addr.family === "IPv4" && !addr.internal) {
        addresses.push(addr.address);
      }
    }
  }

  return addresses;
}
