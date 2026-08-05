import { createHash } from "node:crypto";

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function computeUrlHash(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex");
}
