"use client";

import { useCallback, useEffect, useState } from "react";
import type { MapPoint } from "./map-locations";

export type CourierLocationState = {
  status: "locating" | "ready" | "denied" | "unavailable";
  point: MapPoint | null;
  accuracy: number | null;
};

const locating: CourierLocationState = {
  status: "locating",
  point: null,
  accuracy: null,
};

/** Device coordinates stay in memory and are never sent to the Haulie API. */
export function useCourierLocation(enabled = true) {
  const [location, setLocation] = useState<CourierLocationState>(locating);
  const [revision, setRevision] = useState(0);
  const locate = useCallback(() => {
    setLocation(locating);
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    if (!navigator.geolocation || !window.isSecureContext) {
      queueMicrotask(() => {
        if (active)
          setLocation({ status: "unavailable", point: null, accuracy: null });
      });
      return () => {
        active = false;
      };
    }
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (!active) return;
        const { latitude, longitude, accuracy } = coords;
        if (
          !Number.isFinite(latitude) ||
          Math.abs(latitude) > 90 ||
          !Number.isFinite(longitude) ||
          Math.abs(longitude) > 180 ||
          !Number.isFinite(accuracy) ||
          accuracy < 0
        ) {
          setLocation({ status: "unavailable", point: null, accuracy: null });
          return;
        }
        setLocation({
          status: "ready",
          point: [latitude, longitude],
          accuracy,
        });
      },
      (error) => {
        if (active)
          setLocation({
            status: error.code === 1 ? "denied" : "unavailable",
            point: null,
            accuracy: null,
          });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
    return () => {
      active = false;
      navigator.geolocation.clearWatch(watch);
    };
  }, [enabled, revision]);

  return { location, locate, revision };
}
