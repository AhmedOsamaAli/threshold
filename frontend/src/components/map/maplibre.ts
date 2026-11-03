/* MapLibre GL, the one library that draws the street map, with its worker and its stylesheet. It is a chunk of its own,
   loaded when the first map is shown (components/map/PlaceMap.tsx), so no other page pays for it. */
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";

// The worker is a file of this site, so the page's policy needs no blob: address for it.
maplibregl.setWorkerUrl(workerUrl);

export { maplibregl };
