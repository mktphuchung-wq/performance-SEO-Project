export function normalizeForGscMatch(value: string): string {
  try {
    const decoded = decodeURI(value.trim());
    const url = new URL(decoded);
    url.hash = "";
    const pathname = url.pathname.length > 1 && url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${pathname}${url.search}`;
  } catch {
    try {
      return decodeURI(value.trim()).replace(/\/$/, "");
    } catch {
      return value.trim().replace(/\/$/, "");
    }
  }
}
