"use client";

import dynamic from "next/dynamic";
import type { DemoJob } from "@/lib/demo";
import type { CourierLocationState } from "@/lib/courier-location";
import "./courier-map.css";

export type CourierMapProps = {
  jobs: DemoJob[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  location: CourierLocationState;
  onLocate: () => void;
  locationRevision?: number;
  selectionKey?: number;
  venueSelected?: boolean;
  onVenueSelect?: () => void;
  preview?: boolean;
};

const CourierMapClient = dynamic(() => import("./courier-map-client"), {
  ssr: false,
  loading: () => (
    <div className="courier-map-loading" role="status">
      Loading map…
    </div>
  ),
});

export function CourierMap(props: CourierMapProps) {
  return <CourierMapClient {...props} />;
}
