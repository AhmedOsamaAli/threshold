import { describe, expect, it } from "vitest";
import { createHold, LEAVE_MS, POINTER_ON, type HoldTimers } from "./hoverHold";

/** A clock that only moves when told to, and what is waiting on it. */
function clock() {
  let now = 0;
  let next = 1;
  const waiting = new Map<number, { at: number; run: () => void }>();
  const timers: HoldTimers = {
    set: (run, ms) => {
      const id = next++;
      waiting.set(id, { at: now + ms, run });
      return id;
    },
    clear: (id) => {
      waiting.delete(id);
    },
  };
  return {
    timers,
    pending: () => waiting.size,
    tick(ms: number) {
      now += ms;
      for (const [id, timer] of [...waiting]) {
        if (timer.at > now) continue;
        waiting.delete(id);
        timer.run();
      }
    },
  };
}

function rig(over = false) {
  const time = clock();
  const state = { over, released: 0 };
  const hold = createHold({
    release: () => {
      state.released += 1;
    },
    isOver: () => state.over,
    timers: time.timers,
  });
  return { hold, time, state };
}

describe("the grace a hover card is given", () => {
  it("puts the card away once the pointer has left and stayed away", () => {
    const { hold, time, state } = rig();
    hold.leave();
    time.tick(LEAVE_MS - 1);
    expect(state.released).toBe(0);
    time.tick(1);
    expect(state.released).toBe(1);
    expect(time.pending()).toBe(0);
  });

  it("keeps the card when the pointer comes back in time, to a pin or to the card", () => {
    const { hold, time, state } = rig();
    hold.leave();
    time.tick(LEAVE_MS - 20);
    hold.enter();
    time.tick(1_000);
    expect(state.released).toBe(0);
    expect(time.pending()).toBe(0);
  });

  it("keeps the card when the page says the pointer is on it, whatever order the events came in", () => {
    // A card that opens under a resting pointer: the card is entered first, then the pin beneath it is left.
    const { hold, time, state } = rig(true);
    hold.enter();
    hold.leave();
    time.tick(LEAVE_MS);
    expect(state.released).toBe(0);
    // Once the pointer really leaves, the card goes.
    state.over = false;
    hold.leave();
    time.tick(LEAVE_MS);
    expect(state.released).toBe(1);
  });

  it("starts the grace again when the pointer leaves a second time, and puts the card away once", () => {
    const { hold, time, state } = rig();
    hold.leave();
    time.tick(LEAVE_MS - 50);
    hold.leave();
    expect(time.pending()).toBe(1);
    time.tick(LEAVE_MS - 50);
    expect(state.released).toBe(0);
    time.tick(50);
    expect(state.released).toBe(1);
  });

  it("forgets what was about to go when it is cancelled, and is harmless when nothing is", () => {
    const { hold, time, state } = rig();
    hold.enter();
    hold.cancel();
    hold.leave();
    hold.cancel();
    time.tick(1_000);
    expect(state.released).toBe(0);
    expect(time.pending()).toBe(0);
  });

  it("does the latest thing it was told to do when the pointer has really left", () => {
    const { hold, time, state } = rig();
    const seen: string[] = [];
    hold.onRelease(() => {
      seen.push("first");
    });
    hold.onRelease(() => {
      seen.push("second");
    });
    hold.leave();
    time.tick(LEAVE_MS);
    expect(seen).toEqual(["second"]);
    expect(state.released).toBe(0);
  });

  it("asks about the pointer when the grace is up, not before", () => {
    const time = clock();
    const asked: number[] = [];
    let at = 0;
    const hold = createHold({
      release: () => undefined,
      isOver: () => {
        asked.push(at);
        return false;
      },
      timers: time.timers,
    });
    hold.leave();
    at = 1;
    time.tick(LEAVE_MS);
    expect(asked).toEqual([1]);
  });
});

describe("what counts as the pointer being on the map's pins and cards", () => {
  it("names a pin, the card and a row of the list, each when hovered", () => {
    const parts = POINTER_ON.split(",").map((part) => part.trim());
    expect(parts).toEqual([".mk:hover", ".place-card:hover", ".sp-row:hover"]);
  });
});
