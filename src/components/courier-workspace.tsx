"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock3, Package, Search } from "lucide-react";
import { formatMoney, isOwnCourierJob, STATUS, type DemoJob } from "@/lib/demo";
import { formatSui } from "@/lib/sui/live-escrow-config";
import { CourierMap } from "./courier-map";
import type { CourierLocationState } from "@/lib/courier-location";
import {
  distanceKm,
  getJobMapLocations,
  NEARBY_RADIUS_KM,
  TORANOMON_FORUM,
} from "@/lib/map-locations";
import {
  WorkspaceConnections,
  type WorldConnectionStatus,
} from "./workspace-connections";
import "./courier-workspace.css";

type Props = {
  jobs: DemoJob[];
  location: CourierLocationState;
  onLocate: () => void;
  locationRevision: number;
  venueSelected: boolean;
  onVenueSelect: () => void;
  resumeJobId?: string | null;
  onDetails: (id: string) => void;
  onVerify: (id: string, stage: "ACCEPT" | "PICKUP") => void;
  onWorldStatus: (status: WorldConnectionStatus | null) => void;
  onWalletChange: (address: string | null) => void;
};

export function CourierWorkspace({
  jobs,
  location,
  onLocate,
  locationRevision,
  venueSelected,
  onVenueSelect,
  resumeJobId,
  onDetails,
  onVerify,
  onWorldStatus,
  onWalletChange,
}: Props) {
  const router = useRouter();
  const [chosenTab, setTab] = useState<"available" | "assigned" | null>(null);
  const tab = chosenTab ?? (resumeJobId ? "assigned" : "available");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [selectionKey, setSelectionKey] = useState(0);
  const [area, setArea] = useState("nearby");
  function selectDelivery(id: string) {
    setSelection(id);
    setSelectionKey((value) => value + 1);
  }
  const allAvailable = jobs.filter(
    (job) => job.status === "FUNDED" && !job.courier,
  );
  const searchOrigin =
    location.status === "ready" && location.point
      ? location.point
      : TORANOMON_FORUM.point;
  const available =
    area === "all"
      ? allAvailable
      : allAvailable.filter((job) => {
          const pickup = getJobMapLocations(job).pickup;
          return pickup && distanceKm(searchOrigin, pickup) <= NEARBY_RADIUS_KM;
        });
  const assigned = jobs.filter(
    (job) => isOwnCourierJob(job) && !["PAID", "REFUNDED"].includes(job.status),
  );
  const listed = (tab === "available" ? available : assigned).filter((job) =>
    `${job.id} ${job.title} ${job.pickup} ${job.destination}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selected =
    listed.find((job) => job.id === (selection ?? resumeJobId)) ?? listed[0];

  return (
    <section className="courier-workspace" aria-label="Courier workspace">
      <div className="courier-workspace-body">
        <div className="courier-workspace-map">
          <CourierMap
            jobs={listed}
            selectedId={selected?.id ?? null}
            onSelect={selectDelivery}
            location={location}
            onLocate={onLocate}
            locationRevision={locationRevision}
            venueSelected={venueSelected}
            onVenueSelect={onVenueSelect}
            selectionKey={selectionKey}
          />
        </div>
        <aside
          className="courier-job-panel"
          aria-label="Deliveries and connections"
        >
          <div
            className="courier-job-tabs"
            role="group"
            aria-label="Delivery view"
          >
            <button
              aria-pressed={tab === "available"}
              onClick={() => {
                setTab("available");
                setQuery("");
              }}
            >
              Available <span>{available.length}</span>
            </button>
            <button
              aria-pressed={tab === "assigned"}
              onClick={() => {
                setTab("assigned");
                setQuery("");
                setSelection(null);
              }}
            >
              Assigned <span>{assigned.length}</span>
            </button>
          </div>
          <div className="courier-job-tools">
            <label className="courier-job-search">
              <Search size={16} />
              <input
                type="search"
                aria-label="Search delivery areas"
                placeholder="Search deliveries"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {tab === "available" && (
              <select
                aria-label="Delivery area"
                title={`Pickups within 25 km of ${venueSelected || location.status !== "ready" ? "Toranomon Hills Forum" : "your device location"}`}
                value={area}
                onChange={(event) => {
                  setArea(event.target.value);
                  setSelection(null);
                  if (event.target.value === "nearby") {
                    if (venueSelected) onVenueSelect();
                    else onLocate();
                  }
                }}
              >
                <option value="nearby">Nearby</option>
                <option value="all">All areas</option>
              </select>
            )}
          </div>
          <div className="courier-job-list">
            {listed.length === 0 && (
              <div className="courier-jobs-empty">
                <Package size={24} />
                <h2>
                  {query
                    ? "No matches"
                    : tab === "available"
                      ? area === "nearby"
                        ? "No deliveries nearby"
                        : "No available deliveries"
                      : "No assigned deliveries"}
                </h2>
                <p>
                  {query
                    ? "Try another area."
                    : tab === "available"
                      ? area === "nearby"
                        ? "No pickups within 25 km."
                        : "New deliveries will appear here."
                      : "Choose a delivery on the map to get started."}
                </p>
              </div>
            )}
            {listed.map((job) => (
              <article
                className={`courier-job${job.id === selected?.id ? " is-selected" : ""}`}
                aria-label={job.title}
                key={job.id}
              >
                <button
                  className="courier-job-select"
                  aria-pressed={job.id === selected?.id}
                  onClick={() => selectDelivery(job.id)}
                >
                  <span className="courier-job-meta">
                    <span>{job.id}</span>
                    <strong>
                      {job.chain ? (
                        <>
                          {formatSui(job.chain.mist).replace(" SUI", "")}{" "}
                          <small>SUI · on-chain</small>
                        </>
                      ) : (
                        <>
                          {formatMoney(job.fee)} <small>USDC</small>
                        </>
                      )}
                    </strong>
                  </span>
                  <h2>{job.title}</h2>
                  <span className="courier-job-route">
                    <span>
                      <i className="pickup-dot" />
                      {job.pickup}
                    </span>
                    <span>
                      <i className="dropoff-dot" />
                      {job.destination}
                    </span>
                  </span>
                  <span className="courier-job-window">
                    <Clock3 size={13} />
                    {job.window}
                    <span>{job.category}</span>
                  </span>
                </button>
                {job.id === selected?.id && (
                  <div className="courier-job-expanded">
                    {tab === "assigned" && (
                      <span className="courier-job-status">
                        {STATUS[job.status].label}
                      </span>
                    )}
                    <div className="courier-job-actions">
                      <button
                        className="button button-secondary"
                        onClick={() => onDetails(job.id)}
                      >
                        Details
                      </button>
                      {job.status === "FUNDED" ? (
                        <button
                          className="button button-primary"
                          onClick={() => onVerify(job.id, "ACCEPT")}
                        >
                          Accept delivery <ArrowRight size={15} />
                        </button>
                      ) : job.status === "ASSIGNED" && !job.pickupVerified ? (
                        <button
                          className="button button-primary"
                          onClick={() => onVerify(job.id, "PICKUP")}
                        >
                          Verify pickup <ArrowRight size={15} />
                        </button>
                      ) : (
                        <button
                          className="button button-primary"
                          onClick={() => onDetails(job.id)}
                        >
                          View delivery <ArrowRight size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
          <div className="courier-job-connections">
            <WorkspaceConnections
              onVerify={() =>
                selected
                  ? onVerify(
                      selected.id,
                      selected.status === "FUNDED" ? "ACCEPT" : "PICKUP",
                    )
                  : router.push("/world-sandbox")
              }
              onStatus={onWorldStatus}
              onWalletChange={onWalletChange}
            />
            <p className="courier-environment-note">
              Test deliveries · simulated fees
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
