"use client";

import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl, type MapLayerMouseEvent } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { MapPin } from "lucide-react";
import { API, filterParams } from "@/lib/archive-client";
import { fetchJson, isAbortError, readableError } from "@/lib/http";
import type { ArchiveArtifact, ArchiveFilters, MapData, NearbyCenter, NearbyReference } from "@/types/archive";

// MapLibre 6 needs an explicit worker URL when its ESM bundle is built by Next.js/Turbopack.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

type PinKind = "record" | "folklore" | "reference" | "center";
type LngLat = [number, number];

type HeritageMapProps = {
  filters: ArchiveFilters;
  nearby: NearbyReference[];
  /** The place a geo search was centred on. */
  center: NearbyCenter | null;
  /** Artifact ids from the active search; other archive pins are dimmed. null = no search. */
  highlightIds: Set<string> | null;
  onSelect: (artifact: ArchiveArtifact) => void;
  onSelectNearby: (reference: NearbyReference) => void;
};

const EMPTY_DATA: MapData = { artifacts: [], features: [] };
const ROUTE_SOURCE = "heritage-routes";
const ROUTE_LAYER = "heritage-routes-line";

const LEGEND: Array<{ kind: PinKind | "route"; label: string }> = [
  { kind: "record", label: "Archive record" },
  { kind: "route", label: "Heritage route" },
  { kind: "folklore", label: "Folklore" },
  { kind: "reference", label: "Wikipedia reference" },
];

type PinOptions = {
  at: LngLat;
  kind: PinKind;
  title: string;
  dimmed?: boolean;
  onClick?: () => void;
};

/** One marker element for every pin type: a teardrop shape plus a label shown on hover and focus. */
function addPin(map: MapLibreMap, { at, kind, title, dimmed = false, onClick }: PinOptions): Marker {
  const element = document.createElement(onClick ? "button" : "div");
  element.className = `map-marker ${kind}${dimmed ? " dimmed" : ""}`;
  if (onClick) {
    (element as HTMLButtonElement).type = "button";
    element.setAttribute("aria-label", title);
    element.addEventListener("click", onClick);
  }
  const shape = document.createElement("span");
  shape.className = "pin-shape";
  const label = document.createElement("span");
  label.className = "pin-label";
  label.textContent = title;
  element.append(shape, label);
  return new Marker({ element, anchor: "bottom" }).setLngLat(at).addTo(map);
}

export default function HeritageMap({ filters, nearby, center, highlightIds, onSelect, onSelectNearby }: HeritageMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [data, setData] = useState<MapData>(EMPTY_DATA);
  const [message, setMessage] = useState("Loading mapped places…");
  const query = filterParams(filters).toString();

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<MapData>(`${API}/api/map${query ? `?${query}` : ""}`, "Map request failed.", { signal: controller.signal })
      .then((value) => {
        const next = {
          artifacts: Array.isArray(value?.artifacts) ? value.artifacts : [],
          features: Array.isArray(value?.features) ? value.features : [],
        };
        setData(next);
        setMessage(next.artifacts.length || next.features.length ? "" : "No mapped records match these filters.");
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        setData(EMPTY_DATA);
        setMessage(readableError(error, "The archive map is unavailable."));
      });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    if (!container.current || map.current) return;
    const created = new MapLibreMap({
      container: container.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [72.58, 22.9],
      zoom: 6,
    });
    map.current = created;
    created.addControl(new NavigationControl({ showCompass: false }), "top-right");
    const onLoad = () => setStyleReady(true);
    created.on("load", onLoad);
    if (created.isStyleLoaded()) setStyleReady(true);
    return () => {
      created.off("load", onLoad);
      created.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const current = map.current;
    if (!current || !styleReady) return;

    const markers: Marker[] = [];
    const allPoints: LngLat[] = [];
    // When a search is active, the view frames its results instead of the whole archive.
    const focusPoints: LngLat[] = [];
    const routes: Feature<LineString>[] = [];
    const isDimmed = (artifact: ArchiveArtifact | null) => highlightIds !== null && (!artifact || !highlightIds.has(artifact.id));

    for (const point of data.artifacts) {
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
      const at: LngLat = [point.longitude, point.latitude];
      const dimmed = isDimmed(point.artifact);
      markers.push(addPin(current, { at, kind: "record", title: point.artifact.title, dimmed, onClick: () => onSelect(point.artifact) }));
      allPoints.push(at);
      if (!dimmed) focusPoints.push(at);
    }

    for (const feature of data.features) {
      const artifact = feature.artifact;
      if (feature.kind === "route" && feature.geometry.type === "LineString") {
        routes.push({ type: "Feature", geometry: feature.geometry, properties: { id: feature.id } });
        allPoints.push(...feature.geometry.coordinates as LngLat[]);
        continue;
      }
      if (feature.geometry.type !== "Point") continue;
      const [longitude, latitude] = feature.geometry.coordinates;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      const at: LngLat = [longitude, latitude];
      const dimmed = isDimmed(artifact);
      markers.push(addPin(current, {
        at,
        kind: feature.kind === "folklore" ? "folklore" : "record",
        title: feature.title,
        dimmed,
        onClick: artifact ? () => onSelect(artifact) : undefined,
      }));
      allPoints.push(at);
      if (!dimmed) focusPoints.push(at);
    }

    for (const reference of nearby) {
      const at: LngLat = [reference.longitude, reference.latitude];
      markers.push(addPin(current, { at, kind: "reference", title: `${reference.title} (Wikipedia)`, onClick: () => onSelectNearby(reference) }));
      allPoints.push(at);
      focusPoints.push(at);
    }

    if (center) {
      const at: LngLat = [center.longitude, center.latitude];
      markers.push(addPin(current, { at, kind: "center", title: `Searched: ${center.title}` }));
      focusPoints.push(at);
    }

    const selectRoute = (event: MapLayerMouseEvent) => {
      const record = data.features.find((item) => item.id === event.features?.[0]?.properties?.id);
      if (record?.artifact) onSelect(record.artifact);
    };
    const pointer = () => { current.getCanvas().style.cursor = "pointer"; };
    const resetPointer = () => { current.getCanvas().style.cursor = ""; };
    if (routes.length) {
      current.addSource(ROUTE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: routes } as FeatureCollection<LineString> });
      current.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        paint: { "line-color": "#b76c49", "line-width": 3, "line-dasharray": [2, 1.5], "line-opacity": highlightIds ? 0.35 : 0.9 },
      });
      current.on("click", ROUTE_LAYER, selectRoute);
      current.on("mouseenter", ROUTE_LAYER, pointer);
      current.on("mouseleave", ROUTE_LAYER, resetPointer);
    }

    const framed = highlightIds || center ? focusPoints : allPoints;
    if (framed.length) {
      const bounds = framed.reduce((value, point) => value.extend(point), new LngLatBounds());
      current.fitBounds(bounds, { padding: 70, maxZoom: center ? 12 : 10, duration: 500 });
    }

    return () => {
      markers.forEach((marker) => marker.remove());
      if (current.getLayer(ROUTE_LAYER)) {
        current.off("click", ROUTE_LAYER, selectRoute);
        current.off("mouseenter", ROUTE_LAYER, pointer);
        current.off("mouseleave", ROUTE_LAYER, resetPointer);
        current.removeLayer(ROUTE_LAYER);
      }
      if (current.getSource(ROUTE_SOURCE)) current.removeSource(ROUTE_SOURCE);
    };
  }, [data, nearby, center, highlightIds, onSelect, onSelectNearby, styleReady]);

  const archiveCount = data.artifacts.length + data.features.length;
  const visibleMessage = message && nearby.length ? `${message} Wikipedia references are still shown.` : message;
  return (
    <div className="map-wrap">
      <div className="map-canvas" ref={container} />
      {visibleMessage && <div className="map-message" role="status"><MapPin size={18} aria-hidden />{visibleMessage}</div>}
      <div className="map-legend">
        <p className="legend-title">
          {archiveCount} mapped {archiveCount === 1 ? "item" : "items"}
          {highlightIds && ` · ${highlightIds.size} in results`}
        </p>
        <ul>
          {LEGEND.map((item) => <li key={item.kind}><span className={`legend-swatch ${item.kind}`} aria-hidden />{item.label}</li>)}
          {center && <li><span className="legend-swatch center" aria-hidden />Searched place</li>}
        </ul>
      </div>
    </div>
  );
}
