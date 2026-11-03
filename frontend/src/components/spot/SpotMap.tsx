import { useMemo } from "react";
import type { Spot, SpotNeighbor } from "../../api/spot";
import { cx } from "../../lib/css";
import { metresText, topKindsText, walkMinutes } from "../../lib/spot";
import { PlaceMap, type MapPin } from "../map/PlaceMap";
import { PinMark } from "./PlaceCard";
import { SpotPlan } from "./SpotPlan";
import { useCards } from "./useCards";

/** The pins of the places an answer names: each is numbered as in the list, and read out with its distance. */
export function pinsOf(places: readonly SpotNeighbor[]): MapPin[] {
  return places.map((place, index) => ({
    id: String(index),
    lat: place.lat,
    lon: place.lon,
    label: String(index + 1),
    title: `${index + 1}. ${place.name}, ${metresText(place.distance_m)} away`,
  }));
}

/**
 * A checked spot as a street map and the places on it: the walking area over OpenStreetMap's streets, parks and places,
 * a numbered pin for each place of the asked kind, and the same places listed beside it, nearest first. Pointing at a pin
 * or a row brings up a small card, pressing one opens its details (hours, address, phone and website when OpenStreetMap
 * has them, and links to its page there and to its ratings and photos on Google Maps). Without a map that loads, the
 * plain plan stands in and the list still works.
 */
export function SpotMap({ spot }: { spot: Spot }) {
  const places = useMemo(() => spot.same_kind?.nearest ?? [], [spot]);
  const count = spot.same_kind?.count ?? null;
  const pins = useMemo(() => pinsOf(places), [places]);
  const centre = useMemo(
    () => ({ lat: spot.place.lat, lon: spot.place.lon, title: `The address: ${spot.place.label}` }),
    [spot.place],
  );
  const ring = spot.area?.ring ?? null;
  const cards = useCards(places);

  return (
    <div className="spot-grid">
      <div className="spot-mapcol">
        <PlaceMap
          label={`A map of the ${spot.walk_minutes}-minute walk from ${spot.place.label}, with ${places.length} ${spot.kind} places numbered`}
          centre={centre}
          ring={ring}
          pins={pins}
          active={cards.active}
          show={cards.show}
          onPoint={cards.point}
          onSelect={cards.select}
          onBackground={cards.close}
          fallback={<SpotPlan spot={spot} />}
        >
          {cards.card}
        </PlaceMap>
        <p className="spot-legend mono">
          Blue: {spot.walk_minutes} minutes on foot{spot.area?.source === "circle" ? " (a circle of that radius, not the streets)" : " along streets"}
          {places.length ? ` · numbers: the nearest ${spot.kind} places${places.length > 6 ? " (zoom in for every number)" : ""}` : ""} · the
          rest is what OpenStreetMap lists
        </p>
      </div>
      <div className="spot-facts">
        {count !== null ? (
          <p className="spot-count">
            <b>{count}</b> listed {spot.kind} place{count === 1 ? "" : "s"} in the walk
          </p>
        ) : null}
        {places.length ? (
          <>
            <h3 className="mono label">
              Nearest of the same kind{count !== null && places.length < count ? ` · ${places.length} of ${count}` : ""}
            </h3>
            <ol className="spot-places">
              {places.map((place, index) => {
                const id = String(index);
                return (
                  <li key={`${place.name}-${place.distance_m}-${index}`}>
                    <button
                      type="button"
                      ref={cards.row(id)}
                      className={cx("sp-row", cards.active === id && "on")}
                      aria-haspopup="dialog"
                      aria-expanded={cards.isOpen(id)}
                      onClick={(event) => {
                        cards.select(id, event.detail === 0);
                      }}
                      onPointerEnter={(event) => {
                        if (event.pointerType === "mouse") cards.point(id, "pointer");
                      }}
                      onPointerLeave={(event) => {
                        if (event.pointerType === "mouse") cards.point(null, "pointer");
                      }}
                      onFocus={() => {
                        cards.point(id, "focus");
                      }}
                      onBlur={() => {
                        cards.point(null, "focus");
                      }}
                    >
                      <PinMark mark={String(index + 1)} />
                      <span className="sp-name">{place.name}</span>
                      <span className="sp-kind mono">{place.kind}</span>
                      <span className="sp-dist mono">
                        {metresText(place.distance_m)} · {walkMinutes(place.distance_m)} min
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}
        {spot.around ? (
          <>
            <h3 className="mono label">{spot.around.count} places of any kind listed around</h3>
            {spot.around.top_kinds.length ? <p className="spot-kinds">{topKindsText(spot.around.top_kinds)}</p> : null}
            {spot.around.green.length ? (
              <>
                <h3 className="mono label">Parks and gardens in the walk</h3>
                <p className="spot-kinds">{spot.around.green.map((each) => `${each.name} (${metresText(each.distance_m)})`).join(", ")}</p>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
