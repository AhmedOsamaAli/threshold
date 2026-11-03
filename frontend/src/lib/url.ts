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

/** A place on Google Maps by name, around its coordinates: its card there has the ratings, photos and hours. */
export function googlePlaceUrl(name: string, lat: number, lon: number): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat.toFixed(6)},${lon.toFixed(6)},18z`;
}

/** A place's page on OpenStreetMap, from its id ("node/123", "way/456", "relation/789"); null for anything else. */
export function osmPageUrl(id: string | null | undefined): string | null {
  return typeof id === "string" && /^(node|way|relation)\/[1-9]\d{0,14}$/.test(id) ? `https://www.openstreetmap.org/${id}` : null;
}

/** A link to a place's own website: http or https only, so no script URL can ever be opened. */
export function webLink(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname ? parsed.href : null;
  } catch {
    return null;
  }
}
