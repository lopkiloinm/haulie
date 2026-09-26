"use client";

import type { DemoJob } from "@/lib/demo";
import { TORANOMON_FORUM } from "@/lib/map-locations";
import { CourierMap } from "./courier-map";
import "./delivery-map.css";

type DeliveryMapProps = {
  className?: string;
  compact?: boolean;
  job?: DemoJob;
};

/** A real area map of the delivery endpoints, not live courier tracking. */
export function DeliveryMap({
  className = "",
  compact = false,
  job,
}: DeliveryMapProps) {
  return (
    <div
      className={`delivery-area-preview ${compact ? "is-compact" : ""} ${className}`}
    >
      <CourierMap
        key={job?.id ?? "venue"}
        jobs={job ? [job] : []}
        selectedId={job?.id ?? null}
        onSelect={() => {}}
        location={{
          status: "ready",
          point: TORANOMON_FORUM.point,
          accuracy: null,
        }}
        onLocate={() => {}}
        venueSelected
        selectionKey={job ? 1 : 0}
        preview
      />
    </div>
  );
}

export default DeliveryMap;
