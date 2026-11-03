/* Check a spot, drawn and worded: the walking area and the places OpenStreetMap lists in it as a plan (north up), and
   distances in plain words. Pure, so it is tested without a browser. */
import type { Spot } from "../api/spot";

export interface PlanDot {
  x: number;
  y: number;
  /** The kind of business that was asked about, as against the others around it. */
  same: boolean;
}

export interface Plan {
  /** The square the plan is drawn in, in SVG units. */
  size: number;
  /** The walking area's outline as an SVG points list. */
  ring: string;
  centre: { x: number; y: number };
  dots: PlanDot[];
}

const PAD = 14;
const round = (value: number) => Math.round(value * 10) / 10;

/** The plan of a checked spot: the walking area fitted to the square and the places in it, or null when the check has
 * no area to draw. */
export function planOf(spot: Pick<Spot, "place" | "area" | "around">, size = 320): Plan | null {
  const ring = spot.area?.ring;
  if (!ring || ring.length < 3) return null;
  const { lat: lat0, lon: lon0 } = spot.place;
  const stretch = Math.cos((lat0 * Math.PI) / 180);
  const flat = (lat: number, lon: number) => ({ x: (lon - lon0) * stretch, y: lat0 - lat });
  const outline = ring.map(([lat, lon]) => flat(lat, lon));
  const reach = Math.max(...outline.map((point) => Math.max(Math.abs(point.x), Math.abs(point.y))));
  if (!Number.isFinite(reach) || reach <= 0) return null;
  const scale = (size / 2 - PAD) / reach;
  const place = (point: { x: number; y: number }) => ({ x: round(size / 2 + point.x * scale), y: round(size / 2 + point.y * scale) });
  const dots: PlanDot[] = [];
  for (const [lat, lon, same] of spot.around?.dots ?? []) {
    const at = place(flat(lat, lon));
    if (at.x >= 0 && at.x <= size && at.y >= 0 && at.y <= size) dots.push({ ...at, same: same === 1 });
  }
  return {
    size,
    ring: outline.map((point) => {
      const at = place(point);
      return `${at.x},${at.y}`;
    }).join(" "),
    centre: { x: size / 2, y: size / 2 },
    dots,
  };
}

/** "413 m", "1.2 km": to the nearest 10 m under a kilometre, as the server's own sentences say it. */
export function metresText(metres: number): string {
  const rounded = Math.round(metres / 10) * 10;
  if (rounded < 1000) return `${Math.max(10, rounded)} m`;
  const km = metres / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** The kinds of place around, most listed first: "cafe 12, restaurant 8". */
export function topKindsText(kinds: readonly { kind: string; count: number }[]): string {
  return kinds.map((each) => `${each.kind} ${each.count}`).join(", ");
}

/** About how long a walk of this many metres takes: 80 m a minute, and never less than a minute. */
export function walkMinutes(metres: number): number {
  return Math.max(1, Math.round(metres / 80));
}

/** "4 min on foot": how far a place is, as a walker feels it. */
export function walkText(metres: number): string {
  return `${walkMinutes(metres)} min on foot`;
}

/** Opening hours as OpenStreetMap's volunteers write them, a little plainer where that is safe: "24/7" is every hour. */
export function hoursText(hours: string): string {
  return hours.trim() === "24/7" ? "Open 24 hours, every day" : hours;
}

/** The places to try first. Their coordinates are fixed, so trying one never depends on an address search; each was checked
 * on a real run, and each has several places of its kind in the walk (docs/CONTRACT.md). */
export const SPOT_EXAMPLES = [
  { label: "Zamalek, Cairo", lat: 30.06299, lon: 31.21963, kind: "cafe" },
  { label: "Bedford Ave, Brooklyn", lat: 40.7181, lon: -73.9572, kind: "bakery" },
  { label: "Williamsburg, Brooklyn", lat: 40.7081, lon: -73.9571, kind: "gym" },
] as const;
