/** A path the API returns ("/p/abc") as a link to share. */
export function absoluteUrl(path: string, origin = window.location.origin): string {
  return new URL(path, origin).href;
}

/** "goldenhour.cafe/menu": a link as a poster prints it, without the scheme, the tags or a trailing slash. */
export function shortLink(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.host.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

/** Only https images and inline raster data URLs are shown; anything else could be a tracking or script URL. */
export function safeUrl(url: unknown): string | null {
  return typeof url === "string" && (/^https:\/\//i.test(url) || /^data:image\/(png|jpeg|webp);base64,/i.test(url))
    ? url
    : null;
}

/** A place on Google Maps, for a look at the street itself: a search for its coordinates, in a new tab. */
export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}
