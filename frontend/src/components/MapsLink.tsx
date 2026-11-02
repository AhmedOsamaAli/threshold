import { googleMapsUrl } from "../lib/url";

/** "Google Maps ↗" beside a campaign's place: the spot itself, in a new tab. */
export function MapsLink({ lat, lon }: { lat: number; lon: number }) {
  return (
    <a className="maps-link mono" href={googleMapsUrl(lat, lon)} target="_blank" rel="noopener noreferrer">
      Google Maps<span aria-hidden="true"> ↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
