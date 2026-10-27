"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MapLibreMap, Marker, NavigationControl, LngLatBounds, type MapLayerMouseEvent } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { MapPin } from "lucide-react";
import type { ArchiveArtifact } from "@/types/archive";

type RecordItem = {
  id: string;
  title: string;
  category: string;
  era: string | null;
  latitude: number | null;
  longitude: number | null;
  place: string | null;
  image_url: string;
  artifact: ArchiveArtifact;
};
type HeritageFeature = {
  id: string;
  title: string;
  kind: "monument" | "route" | "folklore";
  description: string;
  geometry: GeoJSON.Geometry;
  artifact: ArchiveArtifact | null;
};
type MapData = { artifacts: RecordItem[]; features: HeritageFeature[] };
type MapFilters = { region: string; category: string; era: string };

const emptyData: MapData = { artifacts: [], features: [] };

export default function HeritageMap({
  api,
  filters,
  onSelect,
}: {
  api: string;
  filters: MapFilters;
  onSelect: (artifact: ArchiveArtifact) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [data, setData] = useState<MapData>(emptyData);
  const [message, setMessage] = useState("Loading mapped places…");
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.region) params.set("region", filters.region);
    if (filters.category) params.set("category", filters.category);
    if (filters.era) params.set("era", filters.era);
    return params.toString();
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    const baseUrl = api.replace(/\/$/, "");
    fetch(`${baseUrl}/api/map${query ? `?${query}` : ""}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Map request failed");
        return response.json() as Promise<MapData>;
      })
      .then((value) => {
        const nextData = {
          artifacts: Array.isArray(value?.artifacts) ? value.artifacts : [],
          features: Array.isArray(value?.features) ? value.features : [],
        };
        setData(nextData);
        setMessage(nextData.artifacts.length || nextData.features.length ? "" : "No mapped items match these filters.");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage("Map data is unavailable while the API is offline.");
      });
    return () => controller.abort();
  }, [api, query]);

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

    const draw = () => {
      const markers: Marker[] = [];
      const coordinates: [number, number][] = [];
      const routeFeatures: Feature<LineString>[] = [];

      for (const item of data.artifacts) {
        if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) continue;
        const latitude = item.latitude as number;
        const longitude = item.longitude as number;
        const button = document.createElement("button");
        button.className = "map-pin monument";
        button.type = "button";
        button.setAttribute("aria-label", item.title);
        button.title = item.title;
        button.append(document.createElement("span"));
        button.addEventListener("click", () => onSelect(item.artifact));
        markers.push(new Marker({ element: button, anchor: "bottom" }).setLngLat([longitude, latitude]).addTo(current));
        coordinates.push([longitude, latitude]);
      }

      for (const feature of data.features) {
        if (feature.kind === "route" && feature.geometry.type === "LineString") {
          routeFeatures.push({
            type: "Feature",
            geometry: feature.geometry as LineString,
            properties: { id: feature.id, title: feature.title },
          });
          coordinates.push(...feature.geometry.coordinates as [number, number][]);
          continue;
        }
        if (feature.geometry.type !== "Point") continue;
        const [longitude, latitude] = feature.geometry.coordinates;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
        const button = document.createElement("button");
        button.className = `map-pin ${feature.kind}`;
        button.type = "button";
        button.setAttribute("aria-label", feature.title);
        button.title = feature.title;
        button.append(document.createElement("span"));
        button.addEventListener("click", () => {
          if (feature.artifact) onSelect(feature.artifact);
        });
        markers.push(new Marker({ element: button, anchor: "bottom" }).setLngLat([longitude, latitude]).addTo(current));
        coordinates.push([longitude, latitude]);
      }

      const sourceId = "heritage-routes";
      const layerId = "heritage-routes-line";
      const selectRoute = (event: MapLayerMouseEvent) => {
        const featureId = event.features?.[0]?.properties?.id;
        const record = data.features.find((item) => item.id === featureId);
        if (record?.artifact) onSelect(record.artifact);
      };

      if (current.getLayer(layerId)) {
        current.off("click", layerId, selectRoute);
        current.removeLayer(layerId);
      }
      if (current.getSource(sourceId)) current.removeSource(sourceId);
      if (routeFeatures.length) {
        current.addSource(sourceId, {
          type: "geojson",
          data: { type: "FeatureCollection", features: routeFeatures } as FeatureCollection<LineString>,
        });
        current.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          paint: { "line-color": "#ad704f", "line-width": 3, "line-dasharray": [2, 1.5], "line-opacity": 0.9 },
        });
        current.on("click", layerId, selectRoute);
      }

      if (coordinates.length) {
        const bounds = coordinates.reduce(
          (value, point) => value.extend(point),
          new LngLatBounds(),
        );
        current.fitBounds(bounds, { padding: 70, maxZoom: 10, duration: 500 });
      }

      return () => {
        markers.forEach((marker) => marker.remove());
        if (current.getLayer(layerId)) {
          current.off("click", layerId, selectRoute);
          current.removeLayer(layerId);
        }
        if (current.getSource(sourceId)) current.removeSource(sourceId);
      };
    };

    return draw();
  }, [data, onSelect, styleReady]);

  const count = data.artifacts.length + data.features.length;
  return (
    <div className="map-wrap">
      <div className="map-canvas" ref={container} />
      {message && (
        <div className="map-message">
          <MapPin size={18} />{message}
        </div>
      )}
      <div className="map-legend">
        <b>THE LIVING MAP</b>
        <span>{count} MAP RECORDS · MONUMENTS · ROUTES · FOLKLORE</span>
      </div>
    </div>
  );
}
