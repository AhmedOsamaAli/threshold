import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import type { SpotNeighbor } from "../../api/spot";
import { useHold } from "../map/hoverHold";
import { PlaceCard } from "./PlaceCard";

export interface Cards {
  /** The pin to light: the open card's, else the one pointed at or focused. */
  active: string | null;
  /** Asks the map to move to a pin; a new object asks again. */
  show: { id: string } | null;
  point: (id: string | null, how: "pointer" | "focus") => void;
  select: (id: string, byKeyboard: boolean) => void;
  close: () => void;
  /** The card to lay over the map: a small preview under the pointer, or the open one. */
  card: ReactNode;
  /** The ref of a place's row in a list, so that closing a card opened from the keyboard gives the focus back to it. */
  row: (id: string) => (node: HTMLElement | null) => void;
  /** Whether this place's card is open. */
  isOpen: (id: string) => boolean;
}

/**
 * The cards of the places on a map, by their index in `places` (the id of a pin is its index as text). Pointing at a pin
 * or a list row lights it and, for a mouse, brings up a small preview; pressing one opens its full card and moves the map
 * to it; Escape or the card's close button puts it away. A card opened from the keyboard takes focus and gives it back to
 * the row it came from.
 */
export function useCards(places: readonly SpotNeighbor[]): Cards {
  const [lit, setLit] = useState<string | null>(null);
  const [previewed, setPreviewed] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; byKeyboard: boolean } | null>(null);
  const [show, setShow] = useState<{ id: string } | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const hold = useHold(() => {
    setLit(null);
    setPreviewed(null);
  });

  function point(id: string | null, how: "pointer" | "focus") {
    if (how === "focus") {
      setLit(id);
      return;
    }
    if (id !== null) {
      hold.enter();
      setLit(id);
      setPreviewed(id);
      return;
    }
    hold.leave();
  }

  function select(id: string, byKeyboard: boolean) {
    hold.cancel();
    setPreviewed(null);
    setLit(id);
    setOpen({ id, byKeyboard });
    setShow({ id });
  }

  function close() {
    const was = open;
    if (!was) return;
    setOpen(null);
    setLit(null);
    if (was.byKeyboard) rows.current.get(was.id)?.focus();
  }

  const closeOnEscape = useEffectEvent(close);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOnEscape();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shownId = open?.id ?? previewed;
  const shown = shownId === null ? undefined : places[Number(shownId)];
  const card =
    shown && shownId !== null ? (
      <PlaceCard
        place={shown}
        mark={String(Number(shownId) + 1)}
        compact={open === null}
        focus={open?.byKeyboard ?? false}
        onClose={close}
        onExpand={() => {
          select(shownId, false);
        }}
        onPointerEnter={() => {
          hold.enter();
        }}
        onPointerLeave={() => {
          hold.leave();
        }}
      />
    ) : null;

  return {
    active: open?.id ?? lit,
    show,
    point,
    select,
    close,
    card,
    row: (id) => (node) => {
      if (node) rows.current.set(id, node);
      else rows.current.delete(id);
    },
    isOpen: (id) => open?.id === id,
  };
}
