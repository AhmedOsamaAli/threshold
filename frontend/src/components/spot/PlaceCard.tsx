import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { SpotNeighbor } from "../../api/spot";
import { cx } from "../../lib/css";
import { hoursText, metresText, walkText } from "../../lib/spot";
import { googlePlaceUrl, osmPageUrl, shortLink, webLink } from "../../lib/url";

/** A place's number, drawn like its pin on the map. */
export function PinMark({ mark, className }: { mark: string; className?: string }) {
  return (
    <span className={cx("pin-mark", className)} aria-hidden="true">
      {mark}
    </span>
  );
}

function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="pc-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span aria-hidden="true"> ↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

interface PlaceCardProps {
  place: SpotNeighbor;
  /** Its number on the map and in the list. */
  mark: string;
  /** The small preview a pointer brings up; the full card opens on a press. */
  compact?: boolean;
  /** Opened from the keyboard: focus moves into the card, and Esc or Close gives it back. */
  focus?: boolean;
  onClose: () => void;
  onExpand?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

/**
 * One place on the map: what it is, how far, and what OpenStreetMap's volunteers wrote down about it (opening hours,
 * address, phone, website, when anyone did). OpenStreetMap holds no ratings or photos, so the card says so and links to the
 * place's card on Google Maps, which has them, and to its own page on OpenStreetMap. Every link opens in a new tab.
 */
export function PlaceCard({ place, mark, compact = false, focus = false, onClose, onExpand, onPointerEnter, onPointerLeave }: PlaceCardProps) {
  const root = useRef<HTMLDivElement>(null);
  const title = useId();

  useEffect(() => {
    if (focus) root.current?.focus({ preventScroll: true });
  }, [place, focus]);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onClose();
  }

  const { details } = place;
  const site = webLink(details?.website);
  const digits = (details?.phone ?? "").replace(/[^\d+]/g, "");
  const osm = osmPageUrl(place.osm);
  const rows: [string, ReactNode][] = [];
  if (details?.hours) rows.push(["Hours", hoursText(details.hours)]);
  if (details?.address) rows.push(["Address", details.address]);
  if (details?.phone) {
    rows.push(["Phone", digits.replace(/\D/g, "").length >= 5 ? <a className="text-link" href={`tel:${digits}`}>{details.phone}</a> : details.phone]);
  }
  if (site) {
    rows.push([
      "Website",
      <a className="text-link" href={site} target="_blank" rel="noopener noreferrer">
        {shortLink(site)}
      </a>,
    ]);
  }
  const shown = compact ? rows.filter(([name]) => name === "Hours") : rows;

  return (
    <div
      ref={root}
      className={cx("place-card", compact && "preview")}
      role="dialog"
      aria-labelledby={title}
      tabIndex={-1}
      onKeyDown={keyDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="pc-head">
        <PinMark mark={mark} />
        <div className="pc-title">
          <h3 id={title} className="pc-name">
            {place.name}
          </h3>
          <p className="pc-role mono">
            {place.kind} · {metresText(place.distance_m)} · {walkText(place.distance_m)}
          </p>
        </div>
        <button type="button" className="pc-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {shown.length ? (
        <dl className="pc-facts">
          {shown.map(([name, value]) => (
            <div key={name}>
              <dt className="mono">{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {!compact && !rows.length ? (
        <p className="pc-known">Nobody has added opening hours, an address, a phone or a website for it to OpenStreetMap yet.</p>
      ) : null}
      {!compact ? <p className="pc-known">OpenStreetMap has no ratings or photos. Google Maps does.</p> : null}
      <OutLink href={googlePlaceUrl(place.name, place.lat, place.lon)}>Ratings and photos on Google Maps</OutLink>
      {osm ? <OutLink href={osm}>Open it on OpenStreetMap</OutLink> : null}
      {compact && onExpand ? (
        <button className="pc-details" type="button" onClick={onExpand}>
          View details
        </button>
      ) : null}
      {!compact ? <p className="pc-source mono">Map data © OpenStreetMap contributors</p> : null}
    </div>
  );
}
