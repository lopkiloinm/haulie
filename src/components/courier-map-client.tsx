"use client";

import { useEffect, useRef, useState } from "react";
import { Home, LocateFixed, MapPin, Maximize, Minus, Plus } from "lucide-react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  getJobMapLocations,
  TORANOMON_FORUM,
  type MapPoint,
} from "@/lib/map-locations";
import type { DemoJob } from "@/lib/demo";
import type { CourierMapProps } from "./courier-map";

function markerIcon(label: string, kind: "pickup" | "dropoff" | "offer") {
  const content = document.createElement("span");
  content.className = `courier-map-pin courier-map-pin-${kind}`;
  content.textContent = label;
  return L.divIcon({
    className: "courier-map-marker",
    html: content,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    tooltipAnchor: [0, -24],
    popupAnchor: [0, -22],
  });
}

function labelNode(text: string) {
  const node = document.createElement("span");
  node.textContent = text;
  return node;
}

function makeAccessible(marker: L.Marker, label: string, pressed: boolean, key: string) {
  const node = marker.getElement();
  if (!node) return;
  node.setAttribute("role", "button");
  node.setAttribute("aria-label", label);
  node.setAttribute("aria-pressed", String(pressed));
  node.dataset.courierMarkerKey = key;
  // Leaflet only activates Enter for popup markers. Support both native button
  // keys consistently for offer selection, drop-offs, and grouped pickups.
  node.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    marker.fire("click");
  });
}

export default function CourierMapClient({
  jobs,
  selectedId,
  onSelect,
  location,
  onLocate,
  locationRevision = 0,
  selectionKey = 0,
  venueSelected = false,
  onVenueSelect,
  preview = false,
}: CourierMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const locationRef = useRef<L.LayerGroup | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const selectRef = useRef(onSelect);
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const cameraMode = useRef<"fallback" | "venue" | "location" | "delivery" | "manual">("fallback");
  const wasVenueSelected = useRef<boolean | null>(null);
  const receivedLocation = useRef(false);
  const focusedLocationRevision = useRef(0);
  const fittedSelectionKey = useRef(0);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!host.current) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const map = L.map(host.current, {
      center: TORANOMON_FORUM.point,
      zoom: 15,
      minZoom: 2,
      maxZoom: 19,
      zoomControl: false,
      scrollWheelZoom: false,
      zoomAnimation: !reducedMotion,
      fadeAnimation: !reducedMotion,
      markerZoomAnimation: !reducedMotion,
    });
    mapRef.current = map;
    const canvas = host.current;
    function describeCamera() {
      const center = map.getCenter();
      canvas.dataset.latitude = String(center.lat);
      canvas.dataset.longitude = String(center.lng);
      canvas.dataset.zoom = String(map.getZoom());
    }
    function handleManualInteraction() {
      cameraMode.current = "manual";
    }
    map.on("moveend zoomend", describeCamera);
    canvas.addEventListener("pointerdown", handleManualInteraction);
    canvas.addEventListener("keydown", handleManualInteraction);
    describeCamera();
    map.attributionControl.setPrefix(false);
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19,
      updateWhenIdle: true,
      keepBuffer: 1,
    });
    let loadedTiles = 0;
    let failedTiles = 0;
    tiles.on("loading", () => { loadedTiles = 0; failedTiles = 0; });
    tiles.on("tileload", () => { loadedTiles += 1; });
    tiles.on("tileerror", () => { failedTiles += 1; });
    tiles.on("load", () => setTileError(loadedTiles === 0 && failedTiles > 0));
    tiles.addTo(map);
    tilesRef.current = tiles;
    markersRef.current = L.layerGroup().addTo(map);
    locationRef.current = L.layerGroup().addTo(map);
    const venueIcon = document.createElement("span");
    venueIcon.className = "courier-map-venue-pin";
    const venue = L.marker(TORANOMON_FORUM.point, {
      icon: L.divIcon({
        className: "courier-map-venue-marker",
        html: venueIcon,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        tooltipAnchor: [0, -24],
      }),
      keyboard: false,
      autoPanOnFocus: false,
      zIndexOffset: 100,
    }).bindTooltip(labelNode(TORANOMON_FORUM.name), {
      direction: "top",
      className: "courier-map-tooltip",
    }).addTo(map);
    venue.getElement()?.setAttribute("role", "img");
    venue.getElement()?.setAttribute("aria-label", `${TORANOMON_FORUM.name} landmark`);

    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false, pan: true });
      if (cameraMode.current === "delivery" && boundsRef.current) {
        map.fitBounds(boundsRef.current, {
          paddingTopLeft: [56, 76],
          paddingBottomRight: [70, 72],
          maxZoom: 16,
          animate: false,
        });
      }
    });
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", handleManualInteraction);
      canvas.removeEventListener("keydown", handleManualInteraction);
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
      locationRef.current = null;
      tilesRef.current = null;
      cameraMode.current = "fallback";
      wasVenueSelected.current = null;
      receivedLocation.current = false;
      focusedLocationRevision.current = 0;
      fittedSelectionKey.current = 0;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = locationRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (venueSelected) {
      const requested = wasVenueSelected.current !== true || focusedLocationRevision.current !== locationRevision;
      wasVenueSelected.current = true;
      receivedLocation.current = false;
      focusedLocationRevision.current = locationRevision;
      if (requested) {
        cameraMode.current = "venue";
        map.setView(TORANOMON_FORUM.point, 15, { animate: false });
      }
      return;
    }
    if (wasVenueSelected.current) cameraMode.current = "fallback";
    wasVenueSelected.current = false;
    if (!location.point) {
      if (
        (location.status === "denied" || location.status === "unavailable") &&
        cameraMode.current !== "manual" &&
        cameraMode.current !== "delivery"
      ) {
        cameraMode.current = "fallback";
        map.setView(TORANOMON_FORUM.point, 15, { animate: false });
      }
      return;
    }
    if (location.accuracy !== null && location.accuracy > 0) {
      L.circle(location.point, {
        radius: location.accuracy,
        color: "#3478c5",
        weight: 1,
        opacity: 0.35,
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(layer);
    }
    const marker = L.circleMarker(location.point, {
      radius: 7,
      fillColor: "#3478c5",
      fillOpacity: 1,
      color: "#fff",
      weight: 3,
    }).bindTooltip(labelNode("Your location")).addTo(layer);
    marker.getElement()?.setAttribute("role", "img");
    marker.getElement()?.setAttribute("aria-label", "Your location");
    if (location.status !== "ready") return;
    const firstFix = !receivedLocation.current;
    const requested = focusedLocationRevision.current !== locationRevision;
    receivedLocation.current = true;
    focusedLocationRevision.current = locationRevision;
    if (
      requested ||
      (firstFix && cameraMode.current === "fallback") ||
      cameraMode.current === "location"
    ) {
      const zoom = requested || firstFix ? 14 : map.getZoom();
      cameraMode.current = "location";
      map.setView(location.point, zoom, { animate: false });
    }
  }, [location, locationRevision, venueSelected]);

  useEffect(() => {
    const map = mapRef.current;
    const layers = markersRef.current;
    if (!map || !layers) return;
    const focusedKey = document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset.courierMarkerKey
      : undefined;
    layers.clearLayers();
    const selected = jobs.find((job) => job.id === selectedId);
    const groups = new Map<string, { point: MapPoint; jobs: DemoJob[] }>();
    const allPoints: MapPoint[] = [];

    for (const job of jobs) {
      const { pickup, destination } = getJobMapLocations(job);
      if (destination) allPoints.push(destination);
      if (!pickup) continue;
      allPoints.push(pickup);
      const key = pickup.join(",");
      const group = groups.get(key) ?? { point: pickup, jobs: [] };
      group.jobs.push(job);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      const selectedInGroup = group.jobs.find((job) => job.id === selectedId);
      const area = group.jobs[0].pickup;
      const label = selectedInGroup ? "A" : group.jobs.length > 1 ? String(group.jobs.length) : "•";
      const marker = L.marker(group.point, {
        icon: markerIcon(label, selectedInGroup ? "pickup" : "offer"),
        keyboard: true,
        autoPanOnFocus: false,
        title: `${area} pickup area`,
        zIndexOffset: selectedInGroup ? 400 : 0,
      }).addTo(layers);
      marker.bindTooltip(labelNode(`${area} · pickup area`), {
        direction: "top",
        className: "courier-map-tooltip",
      });
      makeAccessible(marker, `${area} pickup area, ${group.jobs.length} ${group.jobs.length === 1 ? "delivery" : "deliveries"}`, Boolean(selectedInGroup), `pickup:${group.point.join(",")}`);

      if (group.jobs.length === 1) {
        marker.on("click", () => selectRef.current(group.jobs[0].id));
      } else {
        const options = document.createElement("div");
        options.className = "courier-map-offers";
        options.setAttribute("role", "dialog");
        options.setAttribute("aria-label", `Deliveries in ${area}`);
        options.addEventListener("keydown", (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          map.closePopup();
          marker.getElement()?.focus({ preventScroll: true });
        });
        const title = document.createElement("strong");
        title.textContent = area;
        options.append(title);
        for (const job of group.jobs) {
          const option = document.createElement("button");
          option.type = "button";
          option.textContent = `${job.id} · ${job.destination}`;
          option.setAttribute("aria-pressed", String(job.id === selectedId));
          option.addEventListener("click", () => {
            marker.getElement()?.focus({ preventScroll: true });
            selectRef.current(job.id);
            map.closePopup();
          });
          options.append(option);
        }
        marker.bindPopup(options, { className: "courier-map-popup", minWidth: 190 });
        marker.getElement()?.setAttribute("aria-haspopup", "dialog");
        marker.getElement()?.setAttribute("aria-expanded", "false");
        marker.on("popupopen", () => {
          marker.getElement()?.setAttribute("aria-expanded", "true");
          const initialFocus = options.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
            ?? options.querySelector<HTMLButtonElement>("button");
          initialFocus?.focus({ preventScroll: true });
        });
        marker.on("popupclose", () => marker.getElement()?.setAttribute("aria-expanded", "false"));
      }
    }

    const selectedPoints: MapPoint[] = [];
    if (selected) {
      const { pickup, destination } = getJobMapLocations(selected);
      if (pickup) selectedPoints.push(pickup);
      if (destination) {
        selectedPoints.push(destination);
        const marker = L.marker(destination, {
          icon: markerIcon("B", "dropoff"),
          keyboard: true,
          autoPanOnFocus: false,
          title: `${selected.destination} drop-off area`,
          zIndexOffset: 500,
        }).addTo(layers);
        marker.bindTooltip(labelNode(`${selected.destination} · drop-off area`), {
          direction: "top",
          className: "courier-map-tooltip",
        });
        marker.on("click", () => selectRef.current(selected.id));
        makeAccessible(marker, `${selected.destination} drop-off area for ${selected.id}`, true, `dropoff:${selected.id}`);
      }
    }

    const points = selectedPoints.length ? selectedPoints : allPoints;
    boundsRef.current = points.length ? L.latLngBounds(points) : null;
    if (focusedKey) {
      const nextFocus = Array.from(map.getContainer().querySelectorAll<HTMLElement>("[data-courier-marker-key]"))
        .find((element) => element.dataset.courierMarkerKey === focusedKey);
      nextFocus?.focus({ preventScroll: true });
    }
  }, [jobs, selectedId]);

  useEffect(() => {
    if (selectionKey === fittedSelectionKey.current) return;
    fittedSelectionKey.current = selectionKey;
    if (!boundsRef.current || !mapRef.current) return;
    cameraMode.current = "delivery";
    mapRef.current.fitBounds(boundsRef.current, {
      paddingTopLeft: [56, 76],
      paddingBottomRight: [70, 72],
      maxZoom: 16,
      animate: false,
    });
  }, [selectionKey]);

  function fitDeliveries() {
    const map = mapRef.current;
    if (!map) return;
    if (boundsRef.current) {
      cameraMode.current = "delivery";
      map.fitBounds(boundsRef.current, { paddingTopLeft: [56, 76], paddingBottomRight: [70, 72], maxZoom: 16, animate: false });
    }
  }

  function zoom(amount: number) {
    cameraMode.current = "manual";
    mapRef.current?.zoomIn(amount);
  }

  function useVenue() {
    cameraMode.current = "venue";
    mapRef.current?.setView(TORANOMON_FORUM.point, 15, { animate: false });
    onVenueSelect?.();
  }

  const selected = jobs.find((job) => job.id === selectedId);
  const unmappedSelection = selected && (!getJobMapLocations(selected).pickup || !getJobMapLocations(selected).destination);
  const hasMappedAreas = jobs.some((job) => {
    const points = getJobMapLocations(job);
    return points.pickup || points.destination;
  });
  const locating = !venueSelected && location.status === "locating";
  const showingVenue = !preview && (venueSelected || location.status !== "ready");
  const locationError = !venueSelected && (location.status === "denied" || location.status === "unavailable")
    ? "Using Toranomon Hills Forum. Enable location for your position."
    : "";

  return (
    <div className="courier-map" role="region" aria-label="Delivery area map">
      <div ref={host} className="courier-map-canvas" aria-label="Map. Use arrow keys to pan and plus or minus to zoom." />
      {(showingVenue || jobs.length > 0 || locating) && <div className="courier-map-caption">
          {showingVenue && <span className="courier-map-venue-caption"><MapPin size={13} />{TORANOMON_FORUM.name}</span>}
          {locating && !preview && <span className="courier-map-location-status" role="status">Finding your location…</span>}
          {jobs.length > 0 && <span className="courier-map-legend">
            {!showingVenue && <span>Area preview</span>}
            <span><b className="courier-map-key pickup">A</b> Pickup</span>
            <span><b className="courier-map-key dropoff">B</b> Drop-off</span>
          </span>}
        </div>}
      {!preview && <div className="courier-map-controls" role="group" aria-label="Map controls">
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1)}><Plus size={18} /></button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(-1)}><Minus size={18} /></button>
        <button type="button" aria-label="Fit delivery areas" title="Fit delivery areas" disabled={!hasMappedAreas} onClick={fitDeliveries}><Maximize size={17} /></button>
        <button type="button" aria-label="Back to Toranomon Hills Forum" title="Back to Toranomon Hills Forum" onClick={useVenue}><Home size={17} /></button>
        <button type="button" aria-label={locating ? "Finding your location" : "Find my location"} title="Find my location" aria-busy={locating} disabled={locating} onClick={onLocate}><LocateFixed size={18} /></button>
      </div>}
      {!preview && (locationError || tileError || unmappedSelection) && (
        <div className="courier-map-notice" role="status">
          <span>{locationError || (tileError ? "Map unavailable. Delivery details are still accessible." : "Some areas are not mapped. Check the delivery addresses.")}</span>
          {locationError ? <button type="button" aria-label="Retry location" onClick={onLocate}>Retry</button> : tileError ? <button type="button" onClick={() => tilesRef.current?.redraw()}>Retry</button> : null}
        </div>
      )}
    </div>
  );
}
