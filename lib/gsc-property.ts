/** True when a Search Console URL-prefix or domain property covers a concrete URL. */
export function gscPropertyCoversUrl(gscProperty: string, url: string): boolean {
  if (gscProperty.startsWith("sc-domain:")) {
    const domain = gscProperty.slice("sc-domain:".length).toLowerCase();
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === domain || host.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  }
  try {
    const property = new URL(gscProperty);
    const target = new URL(url);
    return property.protocol === target.protocol
      && property.host === target.host
      && target.pathname.startsWith(property.pathname);
  } catch {
    return false;
  }
}
