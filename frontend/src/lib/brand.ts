/**
 * How long the walk-in plays, in ms: the four steps land, the door shuts behind the last one, swings open and the light
 * spills out (the .bm-* animations in layout.css, the spill ending last at 2.05 s).
 */
export const WALK_IN_MS = 2100;

/**
 * Whether the mark plays its walk again: never with reduced motion; on every click or tap, since phones have no hover;
 * on a mouse hover or keyboard focus only once the last walk has ended, so a pointer crossing its edge does not restart
 * it.
 */
export function replays(cause: "click" | "preview", reducedMotion: boolean, sinceLastMs: number): boolean {
  if (reducedMotion) return false;
  return cause === "click" || sinceLastMs >= WALK_IN_MS;
}
