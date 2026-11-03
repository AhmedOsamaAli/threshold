import { useEffect, useMemo, useRef, useState } from "react";
import { BUSINESS_KINDS, type Campaign } from "../../api/founders";
import { spot as spotApi, type Spot } from "../../api/spot";
import { useNear } from "../../lib/useNear";
import { PlaceMap } from "../map/PlaceMap";
import { MapsLink } from "../MapsLink";
import { pinsOf } from "./SpotMap";
import { useCards } from "./useCards";

const NEAREST = 9;

/** What a campaign's page says about what is around it: the server's sentence when it counted the kind, else only how many
 * businesses are listed (a count of the kind the data cannot give is not explained on a page that is about something else). */
export function aroundText(spot: Spot): string | null {
  if (spot.same_kind) return spot.summary;
  return spot.around ? `${spot.around.count} businesses are listed inside a ${spot.walk_minutes}-minute walk of this address.` : null;
}

/**
 * "Where it will be": the campaign's place on a street map, at once, and, as the section comes into view, what OpenStreetMap
 * lists around it for its kind of business: the walking area over the map, the nearest of the same kind numbered (press one
 * for its card) and the server's sentence about them. It is a look at the neighbourhood, never a promise about demand. When
 * the check cannot be made the map is still there, and nothing else is claimed.
 */
export function CampaignPlace({ campaign }: { campaign: Campaign }) {
  const { lat, lon, label } = campaign.place;
  const kind = BUSINESS_KINDS.find((each) => each === campaign.concept.genre) ?? null;
  const box = useRef<HTMLElement>(null);
  const near = useNear(box);
  const [answer, setAnswer] = useState<Spot | "failed" | null>(null);

  useEffect(() => {
    if (!near || !kind) return;
    const controller = new AbortController();
    spotApi.check({ lat, lon, label }, kind, controller.signal).then(
      (found) => {
        setAnswer(found.checked ? found : "failed");
      },
      () => {
        if (!controller.signal.aborted) setAnswer("failed");
      },
    );
    return () => {
      controller.abort();
    };
  }, [near, kind, lat, lon, label]);

  const spot = answer !== null && answer !== "failed" ? answer : null;
  const places = useMemo(() => spot?.same_kind?.nearest.slice(0, NEAREST) ?? [], [spot]);
  const pins = useMemo(() => pinsOf(places), [places]);
  const centre = useMemo(() => ({ lat, lon, title: `${campaign.name}, ${label}` }), [lat, lon, label, campaign.name]);
  const ring = spot?.area?.ring ?? null;
  const cards = useCards(places);
  const checking = near && kind !== null && answer === null;
  const around = spot ? aroundText(spot) : null;

  return (
    <section className="cp-sec" aria-labelledby="cp-place" ref={box}>
      <h2 className="cp-h" id="cp-place">
        Where it will be
      </h2>
      <PlaceMap
        className="small"
        gentle
        label={`A map of ${label}, where ${campaign.name} plans to open${places.length ? `, with the ${places.length} nearest ${campaign.concept.genre} places numbered` : ""}`}
        centre={centre}
        ring={ring}
        pins={pins}
        active={cards.active}
        show={cards.show}
        onPoint={cards.point}
        onSelect={cards.select}
        onBackground={cards.close}
        fallback={<p className="cp-where">{label}</p>}
      >
        {cards.card}
      </PlaceMap>
      {checking ? (
        <p className="cp-around" role="status">
          Checking what is already around…
        </p>
      ) : null}
      {around ? (
        <p className="cp-around">
          <span className="mono">Already around</span> {around}
        </p>
      ) : null}
      <p className="cp-plan-links">
        <MapsLink lat={lat} lon={lon} />
      </p>
    </section>
  );
}
