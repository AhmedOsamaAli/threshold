/* Which pins on a map would cover each other, as a pure function of where they are on screen, so it is tested without a
   map. */

/** Pins closer than this on screen would cover each other. */
export const PIN_GAP = 30;
/** A pin with a short text (a price) is wider than one with a number. */
export const PILL_GAP = 54;

export interface PinSpot {
  id: string;
  /** What the pin says: its width decides how far from another it must be. */
  label: string;
  /** Where it is on screen, in pixels. */
  x: number;
  y: number;
}

/**
 * The ids of the pins to hide so that none covers another: each pin, in the order given (nearest first), is kept unless it
 * would cover one already kept. The lit pin (pointed at, focused or open) is looked at first and always kept, so it is
 * never the one that disappears.
 */
export function hiddenPins(spots: readonly PinSpot[], lit: string | null): Set<string> {
  const gap = (spot: PinSpot) => (spot.label.length > 2 ? PILL_GAP : PIN_GAP);
  const ordered = [...spots.filter((spot) => spot.id === lit), ...spots.filter((spot) => spot.id !== lit)];
  const kept: PinSpot[] = [];
  const hidden = new Set<string>();
  for (const spot of ordered) {
    const clash = kept.some((other) => Math.hypot(other.x - spot.x, other.y - spot.y) < Math.max(gap(spot), gap(other)));
    if (clash && spot.id !== lit) hidden.add(spot.id);
    else kept.push(spot);
  }
  return hidden;
}
