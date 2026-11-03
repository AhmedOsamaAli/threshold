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
}

export interface Spot {
  place: SpotPlace;
  kind: BusinessKind;
  walk_minutes: number;
  /** false: OpenStreetMap could not be read, and nothing below it is a number. */
  checked: boolean;
  reason: string | null;
  /** null for a kind of business no single tag pins down. */
  same_kind: { count: number | null; nearest: SpotNeighbor[] } | null;
  around: { count: number; top_kinds: { kind: string; count: number }[]; dots: [number, number, 0 | 1][] } | null;
  area: { ring: [number, number][]; source: "walk" | "circle" } | null;
  summary: string;
  source: { name: string; url: string; as_of: string | null };
  checked_at: string;
  note: string;
}

export type SpotWhere = { address: string } | { lat: number; lon: number };

export const spot = {
  check: (where: SpotWhere, kind: BusinessKind, signal?: AbortSignal) => {
    const params = new URLSearchParams({ kind });
    if ("address" in where) params.set("address", where.address);
    else {
      params.set("lat", String(where.lat));
      params.set("lon", String(where.lon));
    }
    return request<Spot>(`/api/spot?${params.toString()}`, { signal });
  },
};
