import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/css";
import { lazyModule } from "../../lib/lazy";
import { prefersReducedMotion } from "../../lib/motion";
import "../../styles/map.css";
import { hiddenPins } from "./pins";

/** The street map's chunk: MapLibre, its worker and its stylesheet, loaded when the first map is shown. */
export const mapChunk = lazyModule(() => import("./maplibre"));

/** OpenFreeMap's "Bright" look: streets, parks, water and every named place, free and without a key. */
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/bright";
const BLUE = "#0b59d0";
/** A map whose style or first tiles have not come by then is given up on, and the plan is shown instead. */
const GIVE_UP_MS = 20_000;

export interface MapPin {
  id: string;
  lat: number;
  lon: number;
  /** What the pin says: a number, or a short text such as "$18". */
  label: string;
  /** What assistive technology reads for it. */
  title: string;
}

export interface PlaceMapProps {
  /** What the map is, for assistive technology. */
  label: string;
  /** The place the map is about, marked with a target. */
  centre?: { lat: number; lon: number; title: string } | null;
  /** The walking area, as [lat, lon] pairs. */
  ring?: readonly (readonly [number, number])[] | null;
  pins?: readonly MapPin[];
  /** The pin that is lit: pointed at, focused or open. */
  active?: string | null;
  /** Asks the map to move to a pin; a new object asks again. */
  show?: { id: string } | null;
  /** The pointer (or focus) is on a pin, or left it. */
  onPoint?: (id: string | null, how: "pointer" | "focus") => void;
  /** A pin was pressed; `byKeyboard` when it was with Enter or Space. */
  onSelect?: (id: string, byKeyboard: boolean) => void;
  /** Somewhere on the map that is no pin was pressed. */
  onBackground?: () => void;
  /** What stands in for the map when it cannot load (no WebGL, no reach to its tiles). */
  fallback: ReactNode;
  className?: string;
  /** Pan and zoom only on a deliberate gesture (two fingers, ctrl and scroll), so that a page with a map still scrolls. */
  gentle?: boolean;
  /** How far in, when there is one place and nothing to fit. */
  zoom?: number;
  /** Laid over the map: a place's card. */
  children?: ReactNode;
}

type Status = "loading" | "ready" | "failed";
type Point = [number, number];
type Lib = Awaited<ReturnType<typeof mapChunk.load>>;

interface Geometry {
  centre: PlaceMapProps["centre"];
  ring: PlaceMapProps["ring"];
  pins: readonly MapPin[];
}

interface Live {
  lib: Lib;
  map: MapLibreMap;
  markers: { pin: MapPin; element: HTMLButtonElement; marker: MapLibreMarker }[];
  here: MapLibreMarker | null;
  /** What the camera was last fitted to, so that a change in the geometry is told from a re-render. */
  fitted: string;
}

const lonLat = (lat: number, lon: number): Point => [lon, lat];

function pointsOf({ centre, ring, pins }: Geometry): Point[] {
  return [
    ...(ring ?? []).map(([lat, lon]) => lonLat(lat, lon)),
    ...pins.map((pin) => lonLat(pin.lat, pin.lon)),
    ...(centre ? [lonLat(centre.lat, centre.lon)] : []),
  ];
}

/** Where the camera goes to show the geometry: a box when the places are spread, else a point and a zoom. */
function frameOf(geometry: Geometry): { bounds: [Point, Point] } | { center: Point } | null {
  const points = pointsOf(geometry);
  const first = points[0];
  if (!first) return null;
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const [west, east, south, north] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  return west < east || south < north ? { bounds: [[west, south], [east, north]] } : { center: first };
}

const keyOf = ({ centre, ring, pins }: Geometry) =>
  `${centre ? `${centre.lat},${centre.lon}` : ""}|${ring?.length ?? 0}|${pins.map((pin) => pin.id).join(",")}`;

/** The walking area, drawn (or drawn again) over the map's own layers. */
function drawWalk(map: MapLibreMap, ring: Geometry["ring"]) {
  const outline = ring && ring.length >= 3 ? ring.map(([lat, lon]) => lonLat(lat, lon)) : [];
  const first = outline[0];
  const data = {
    type: "FeatureCollection" as const,
    features: first
      ? [{ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [[...outline, first]] } }]
      : [],
  };
  const source = map.getSource<GeoJSONSource>("walk");
  if (source) {
    // A walk that cannot be redrawn leaves the old shape; the pins and the list do not depend on it.
    source.setData(data).catch(() => undefined);
    return;
  }
  map.addSource("walk", { type: "geojson", data });
  map.addLayer({ id: "walk-fill", type: "fill", source: "walk", paint: { "fill-color": BLUE, "fill-opacity": 0.1 } });
  map.addLayer({
    id: "walk-line", type: "line", source: "walk",
    paint: { "line-color": BLUE, "line-width": 2.5, "line-dasharray": [2, 1.2] },
  });
}

/** Hides the pins that would cover each other, keeping the lit one. */
function declutter(current: Live | null, lit: string | null) {
  if (!current) return;
  const hidden = hiddenPins(
    current.markers.map(({ pin }) => {
      const at = current.map.project([pin.lon, pin.lat]);
      return { id: pin.id, label: pin.label, x: at.x, y: at.y };
    }),
    lit,
  );
  for (const { pin, element } of current.markers) element.hidden = hidden.has(pin.id);
}

/**
 * A street map of one place and what is around it: OpenFreeMap's streets, parks and places, the walking area drawn over
 * them, and a pin for each place the page lists. The pins are buttons, so the keyboard reaches them, and they hide where
 * they would cover each other (the list beside the map has every place). The walking area, the pins and the target can
 * change while the map stays: the camera moves to fit what is new.
 */
export function PlaceMap({
  label, centre = null, ring = null, pins = [], active = null, show = null, onPoint, onSelect, onBackground, fallback,
  className, gentle = false, zoom = 15, children,
}: PlaceMapProps) {
  const holder = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const activeNow = useRef<string | null>(null);
  const latest = useRef<Geometry>({ centre, ring, pins });
  const calls = useRef({ onPoint, onSelect, onBackground });
  const [status, setStatus] = useState<Status>("loading");
  /** Counts the maps built, so that what depends on the map runs once it exists. */
  const [built, setBuilt] = useState(0);

  useEffect(() => {
    calls.current = { onPoint, onSelect, onBackground };
    latest.current = { centre, ring, pins };
    activeNow.current = active;
  });

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    let cancelled = false;
    let timer: number | undefined;
    const giveUp = (map: MapLibreMap | null) => {
      window.clearTimeout(timer);
      map?.remove();
      live.current = null;
      if (!cancelled) setStatus("failed");
    };
    mapChunk.load().then(
      (lib) => {
        if (cancelled) return;
        const geometry = latest.current;
        const frame = frameOf(geometry);
        let map: MapLibreMap;
        try {
          map = new lib.maplibregl.Map({
            container: element,
            style: MAP_STYLE,
            ...(frame && "bounds" in frame
              ? { bounds: frame.bounds, fitBoundsOptions: { padding: gentle ? 28 : 46, maxZoom: 17 } }
              : { center: frame?.center ?? ([0, 20] as Point), zoom: frame ? zoom : 1.5 }),
            attributionControl: { compact: true },
            cooperativeGestures: gentle,
            pitchWithRotate: false,
            dragRotate: false,
            touchPitch: false,
            maxPitch: 0,
            fadeDuration: prefersReducedMotion() ? 0 : 200,
          });
        } catch {
          giveUp(null); // no WebGL, or a browser that will not draw it
          return;
        }
        map.addControl(new lib.maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.on("style.load", () => {
          drawWalk(map, latest.current.ring);
        });
        map.on("move", () => {
          declutter(live.current, activeNow.current);
        });
        map.on("resize", () => {
          declutter(live.current, activeNow.current);
        });
        map.on("click", () => calls.current.onBackground?.());
        live.current = { lib, map, markers: [], here: null, fitted: keyOf(geometry) };
        setBuilt((count) => count + 1);

        let ready = false;
        map.once("load", () => {
          ready = true;
          window.clearTimeout(timer);
          declutter(live.current, activeNow.current);
          if (!cancelled) setStatus("ready");
        });
        map.on("error", () => {
          if (!ready) giveUp(map); // its style never came; later tile errors are only gaps in the picture
        });
        timer = window.setTimeout(() => {
          if (!ready) giveUp(map);
        }, GIVE_UP_MS);
      },
      () => {
        giveUp(null); // the map's chunk could not load
      },
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      live.current?.map.remove();
      live.current = null;
    };
  }, [gentle, zoom]);

  // The walking area, and the camera that fits what the map now shows.
  useEffect(() => {
    const current = live.current;
    if (!current) return;
    const { map } = current;
    if (map.isStyleLoaded()) drawWalk(map, ring);
    else map.once("idle", () => {
      drawWalk(map, latest.current.ring);
    });
    const geometry = { centre, ring, pins };
    const key = keyOf(geometry);
    if (key === current.fitted) return;
    current.fitted = key;
    const frame = frameOf(geometry);
    const duration = prefersReducedMotion() ? 0 : 500;
    if (frame && "bounds" in frame) map.fitBounds(frame.bounds, { padding: gentle ? 28 : 46, maxZoom: 17, duration });
    else if (frame) map.easeTo({ center: frame.center, zoom, duration });
  }, [ring, pins, centre, gentle, zoom, built]);

  // The pins.
  useEffect(() => {
    const current = live.current;
    if (!current) return;
    for (const { marker } of current.markers) marker.remove();
    current.markers = pins.map((pin) => {
      // MapLibre moves this button with its own transform, so only the face inside it may grow on hover (see map.css).
      const element = document.createElement("button");
      element.type = "button";
      element.className = cx("mk", pin.label.length > 2 && "pill", pin.id === activeNow.current && "on");
      const face = document.createElement("span");
      face.className = "mk-face";
      face.textContent = pin.label;
      element.append(face);
      element.setAttribute("aria-label", pin.title);
      // Pointer events, like the card laid over the map, so that a card that opens under a resting pointer is entered
      // after the pin is left, never before; a finger only presses, and the press opens the card.
      element.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") calls.current.onPoint?.(pin.id, "pointer");
      });
      element.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "mouse") calls.current.onPoint?.(null, "pointer");
      });
      element.addEventListener("focus", () => calls.current.onPoint?.(pin.id, "focus"));
      element.addEventListener("blur", () => calls.current.onPoint?.(null, "focus"));
      element.addEventListener("click", (event) => {
        event.stopPropagation(); // a pin is no click on the map's background
        calls.current.onSelect?.(pin.id, event.detail === 0);
      });
      const marker = new current.lib.maplibregl.Marker({ element, anchor: "center" }).setLngLat([pin.lon, pin.lat]).addTo(current.map);
      return { pin, element, marker };
    });
    declutter(current, activeNow.current);
  }, [pins, built]);

  // The target on the place the map is about.
  useEffect(() => {
    const current = live.current;
    if (!current) return;
    current.here?.remove();
    current.here = null;
    if (!centre) return;
    const here = document.createElement("div");
    here.className = "mk-here";
    here.setAttribute("role", "img");
    here.setAttribute("aria-label", centre.title);
    current.here = new current.lib.maplibregl.Marker({ element: here, anchor: "center" }).setLngLat([centre.lon, centre.lat]).addTo(current.map);
  }, [centre, built]);

  // The lit pin.
  useEffect(() => {
    const current = live.current;
    if (!current) return;
    for (const { pin, element } of current.markers) element.classList.toggle("on", pin.id === active);
    declutter(current, active);
  }, [active, pins, status]);

  // A request to move to a pin.
  useEffect(() => {
    const current = live.current;
    const target = show ? current?.markers.find((each) => each.pin.id === show.id) : undefined;
    if (!current || !target) return;
    current.map.easeTo({
      center: [target.pin.lon, target.pin.lat],
      zoom: Math.max(current.map.getZoom(), 16),
      duration: prefersReducedMotion() ? 0 : 600,
    });
  }, [show, status]);

  return (
    <div className={cx("place-map", className)} data-status={status}>
      <div ref={holder} className="pm-canvas" role="region" aria-label={label} hidden={status === "failed"} />
      {status === "loading" ? (
        <p className="pm-wait mono" role="status">
          Loading the map…
        </p>
      ) : null}
      {status === "failed" ? (
        <div className="pm-fallback">
          {fallback}
          <p className="pm-note">The street map could not load, so this is a plain plan of the walk instead.</p>
        </div>
      ) : null}
      {children}
    </div>
  );
}
