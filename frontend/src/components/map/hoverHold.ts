import { useEffect, useState } from "react";

/** How long the pointer may be between a pin and its card before the card goes. */
export const LEAVE_MS = 220;

/** What counts as the pointer being on a map's pins or cards right now: a pin, the card laid over the map, or a row of the list
 * beside it. Asked of the page itself, so it holds whatever order the pointer's events came in. */
export const POINTER_ON = ".mk:hover, .place-card:hover, .sp-row:hover";

export interface HoldTimers {
  set: (run: () => void, ms: number) => number;
  clear: (id: number) => void;
}

export interface Hold {
  /** The pointer came onto a pin, a row or the card: what was about to go stays. */
  enter: () => void;
  /** The pointer left one: the card goes after a moment, unless the pointer is on one again by then. */
  leave: () => void;
  /** Nothing is about to go (a card was opened or put away by a press or a key). */
  cancel: () => void;
  /** What to do when the pointer has really left: the latest one given is the one done. */
  onRelease: (release: () => void) => void;
}

interface HoldOptions {
  /** Whether the pointer is on a pin, a row or the card now. */
  isOver: () => boolean;
  release?: () => void;
  delay?: number;
  timers?: HoldTimers;
}

/**
 * The grace a hover card is given when the pointer leaves what shows it. A card that opens under a resting pointer takes the
 * pointer from the pin beneath it, and the events that say so can come in either order (React tells a card's pointer of its
 * entering from `pointerout`, before the pin's own `pointerleave`): were the grace only a timer, one that the card's entering
 * did not cancel would put the card away with the pointer on it, the pin below would be pointed at again, and the card would
 * open again, over and over. So when the grace is up the page is asked where the pointer is, and the card goes only if it is on
 * none of them.
 */
export function createHold({ isOver, release = () => undefined, delay = LEAVE_MS, timers }: HoldOptions): Hold {
  const clock: HoldTimers = timers ?? {
    set: (run, ms) => window.setTimeout(run, ms),
    clear: (id) => {
      window.clearTimeout(id);
    },
  };
  let current = release;
  let pending: number | undefined;
  const cancel = () => {
    if (pending === undefined) return;
    clock.clear(pending);
    pending = undefined;
  };
  return {
    enter: cancel,
    leave: () => {
      cancel();
      pending = clock.set(() => {
        pending = undefined;
        if (!isOver()) current();
      }, delay);
    },
    cancel,
    onRelease: (next) => {
      current = next;
    },
  };
}

/** Whether the pointer is on a pin, a row or a card of a map now. */
export function pointerOnMap(): boolean {
  return document.querySelector(POINTER_ON) !== null;
}

/** A hold on the pointer's cards that calls `release` (the latest one given) when the pointer has really left them. */
export function useHold(release: () => void): Hold {
  const [hold] = useState(() => createHold({ isOver: pointerOnMap }));
  useEffect(() => {
    hold.onRelease(release);
  });
  useEffect(
    () => () => {
      hold.cancel();
    },
    [hold],
  );
  return hold;
}
