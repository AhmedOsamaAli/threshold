/* Check a spot (GET /api/spot): what OpenStreetMap lists inside a 10-minute walk of an address, for one kind of business.
   It shows what is open nearby, never what people want. */
import { request } from "./client";
import type { BusinessKind } from "./founders";

export interface SpotPlace {
  label: string;
  lat: number;
  lon: number;
}

export interface SpotNeighbor {
  name: string;
  kind: string;
  distance_m: number;
  lat: number;
  lon: number;
  /** Its page on OpenStreetMap ("node/123"), when it has one. */
  osm: string | null;
  /** What OpenStreetMap's volunteers wrote down about it, when they wrote anything. */
  details: SpotDetails | null;
}

/** What a volunteer wrote down about a place in OpenStreetMap: only what is there. Text, never markup. */
export interface SpotDetails {
  hours?: string;
  website?: string;
  phone?: string;
  address?: string;
}

export interface SpotGreen {
  name: string;
  kind: string;
  distance_m: number;
}

export interface Spot {
  place: SpotPlace;
  kind: BusinessKind;
  walk_minutes: number;
  /** false: OpenStreetMap could not be read, and nothing below it is a number. */
  checked: boolean;
  reason: string | null;
  /** null for a kind of business no single tag pins down. `nearest` is the nearest places of the kind, nearest first. */
  same_kind: { count: number | null; nearest: SpotNeighbor[] } | null;
  around: {
    count: number;
    top_kinds: { kind: string; count: number }[];
    dots: [number, number, 0 | 1][];
    /** The nearest parks and gardens. */
    green: SpotGreen[];
  } | null;
  area: { ring: [number, number][]; source: "walk" | "circle" } | null;
  summary: string;
  source: { name: string; url: string; as_of: string | null };
  checked_at: string;
  note: string;
}

/** An address, or a point (with the name to show for it, so a link can say "Zamalek, Cairo"). */
export type SpotWhere = { address: string } | { lat: number; lon: number; label?: string };

export const spot = {
  check: (where: SpotWhere, kind: BusinessKind, signal?: AbortSignal) => {
    const params = new URLSearchParams({ kind });
    if ("address" in where) params.set("address", where.address);
    else {
      params.set("lat", String(where.lat));
      params.set("lon", String(where.lon));
      if (where.label) params.set("label", where.label);
    }
    return request<Spot>(`/api/spot?${params.toString()}`, { signal });
  },
};
