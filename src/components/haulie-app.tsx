"use client";
import { SuiWallet } from "./sui-wallet";
import { CourierWorkspace } from "./courier-workspace";
import {
  WorkspaceConnections,
  type WorldConnectionStatus,
} from "./workspace-connections";
import { WorldActionDialog } from "./world-action-dialog";
import { reconcileWorldJobs } from "@/lib/courier-world";
import {
  useCourierLocation,
  type CourierLocationState,
} from "@/lib/courier-location";
import { TORANOMON_FORUM } from "@/lib/map-locations";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bike,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Clock3,
  FileText,
  Globe2,
  Leaf,
  History,
  LayoutDashboard,
  LockKeyhole,
  MapPin,
  Menu,
  Package,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Store,
  Truck,
  UsersRound,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { DeliveryMap } from "./delivery-map";
import { DeliveryDetail, Modal } from "./delivery-detail";
import {
  INITIAL_SNAPSHOT,
  INITIAL_STATE,
  STATUS,
  formatMoney,
  isOwnCourierJob,
  parseSnapshot,
  persistDemo,
  readSnapshot,
  subscribeDemo,
  transitionJob,
  type DemoAction,
  type DemoJob,
  type DemoRole,
  type DemoState,
} from "@/lib/demo";

type Page = "Overview" | "Deliveries" | "Couriers" | "Wallet" | "Activity";
type Dialog =
  "create" | "guide" | "notifications" | "settings" | "connections" | null;
const NAV: { label: Page; icon: LucideIcon }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Deliveries", icon: Package },
  { label: "Couriers", icon: UsersRound },
  { label: "Wallet", icon: Wallet },
  { label: "Activity", icon: History },
];
const ROLES: DemoRole[] = ["Merchant", "Courier", "Recipient", "Operator"];

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-mark">
        <span>h</span>
        <ArrowUpRight aria-hidden="true" size={13} />
      </span>
      {!small && (
        <span>
          haulie<span className="brand-dot">.</span>
        </span>
      )}
    </span>
  );
}
export function StatusBadge({ job }: { job: DemoJob }) {
  const s = STATUS[job.status];
  return (
    <span className={`badge badge-${s.tone}`}>
      <span className="status-dot" />
      {s.label}
    </span>
  );
}
function Avatar({
  initials,
  small = false,
}: {
  initials: string;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${small ? "avatar-small" : ""} avatar-${initials.charCodeAt(0) % 4}`}
    >
      {initials}
    </span>
  );
}
function EmptyState({
  title,
  text,
  icon: Icon = Package,
}: {
  title: string;
  text: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={28} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export function HaulieApp({
  initialRole = "Merchant",
}: {
  initialRole?: DemoRole;
}) {
  const router = useRouter();
  const snapshot = useSyncExternalStore(
    subscribeDemo,
    readSnapshot,
    () => INITIAL_SNAPSHOT,
  );
  const state = useMemo(() => parseSnapshot(snapshot), [snapshot]);
  const [page, setPage] = useState<Page>("Overview");
  const [role, setRole] = useState<DemoRole>(initialRole);
  const [venueSelected, setVenueSelected] = useState(true);
  const [venueRevision, setVenueRevision] = useState(0);
  const [roleOpen, setRoleOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [worldStatus, setWorldStatus] = useState<WorldConnectionStatus | null>(
    null,
  );
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [worldAction, setWorldAction] = useState<{
    id: string;
    stage: "ACCEPT" | "PICKUP";
  } | null>(null);
  const callbackHandled = useRef(false);
  const [resumeJobId, setResumeJobId] = useState<string | null>(null);
  const [filter, setFilter] = useState("All deliveries");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [dateFilter, setDateFilter] = useState("All time");
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedJob = state.jobs.find((j) => j.id === selected);
  const workspaceJobs =
    role === "Courier" ? state.jobs.filter(isOwnCourierJob) : state.jobs;
  const acceptanceReady =
    role === "Courier"
      ? !!walletAddress && !!worldStatus?.configured
      : state.courierEnrolled && state.walletConnected;
  function receiveWorldStatus(status: WorldConnectionStatus | null) {
    setWorldStatus(status);
    if (status?.connected) {
      const current = parseSnapshot(readSnapshot());
      const updated = reconcileWorldJobs(current, status.jobs);
      if (updated !== current) save(updated);
    }
    if (!callbackHandled.current && typeof window !== "undefined") {
      callbackHandled.current = true;
      const params = new URLSearchParams(window.location.search);
      const result = params.get("result");
      const jobId = params.get("job");
      if (result) {
        // Query strings are navigation hints, never proof of verification.
        const record = jobId ? status?.jobs[jobId] : null;
        if (
          (result === "accepted" && record?.accepted) ||
          (result === "picked-up" && record?.pickedUp)
        ) {
          setResumeJobId(jobId);
          notify(
            result === "accepted" ? "Delivery accepted." : "Pickup verified.",
          );
        } else if (
          ["denied", "failed", "expired", "unavailable"].includes(result)
        )
          notify(
            result === "denied"
              ? "Verification cancelled."
              : "Verification did not complete. Try again.",
          );
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname,
        );
      }
    }
  }
  function requestWorld(id: string, stage: "ACCEPT" | "PICKUP") {
    setSelected(null);
    setWorldAction({ id, stage });
  }
  const active = workspaceJobs.filter(
    (j) => !["PAID", "REFUNDED"].includes(j.status),
  );
  const paid = workspaceJobs.filter((j) => j.status === "PAID");
  const reserved = active.reduce((n, j) => n + j.fee, 0);
  const paidTotal = paid.reduce((n, j) => n + j.fee, 0);
  const spotlight =
    state.jobs.find((j) => j.status === "PICKED_UP") ||
    active[0] ||
    state.jobs[0];
  const displayJobs = workspaceJobs.filter((j) => {
    const matchesQuery =
      `${j.id} ${j.title} ${j.pickup} ${j.destination} ${j.courier || ""}`
        .toLowerCase()
        .includes(query.toLowerCase());
    const matchesStatus =
      filter === "All deliveries" ||
      (filter === "Active" && !["PAID", "REFUNDED"].includes(j.status)) ||
      (filter === "Completed" && j.status === "PAID") ||
      (filter === "Needs attention" &&
        ["DISPUTED", "PAYOUT_RETRY"].includes(j.status));
    const matchesDate =
      dateFilter === "All time" ||
      new Date(j.createdAt).toDateString() === new Date().toDateString();
    return matchesQuery && matchesStatus && matchesDate;
  });
  function notify(message: string) {
    setToast(message);
  }
  function save(next: DemoState) {
    try {
      persistDemo(next);
    } catch {
      notify(
        "Browser storage is unavailable. Please enable it to save changes.",
      );
    }
  }
  async function refreshWorld() {
    const response = await fetch("/api/world-sandbox/status", {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error("Could not refresh verification. Reload to try again.");
    receiveWorldStatus(await response.json());
  }
  async function updateJob(id: string, action: DemoAction, reason?: string) {
    try {
      const current = parseSnapshot(readSnapshot());
      const target = current.jobs.find((j) => j.id === id);
      if (!target) throw new Error("Delivery not found.");
      if (
        action === "ACCEPT" &&
        (!current.courierEnrolled || !current.walletConnected)
      )
        throw new Error(
          "Complete test enrollment and connect the wallet first.",
        );
      if (action === "UNASSIGN" && target.worldAcceptedAt) {
        const response = await fetch("/api/world-sandbox/release", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job: id }),
        });
        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error || "Could not cancel the assignment.");
        }
      }
      const next = transitionJob(target, action, reason);
      save({
        ...current,
        jobs: current.jobs.map((j) => (j.id === id ? next : j)),
      });
      if (action === "UNASSIGN" && target.worldAcceptedAt) await refreshWorld();
      notify(
        {
          ACCEPT: "Delivery accepted. A new pickup check will be required.",
          VERIFY_PICKUP:
            "Pickup check complete. The merchant can now confirm handoff.",
          HANDOFF: "Parcel handed over. Your delivery is on the way.",
          CONFIRM_RECEIPT: "Receipt confirmed. Simulated payment is ready.",
          PAY: "Simulated payment complete. No funds were transferred.",
          FAIL_PAYOUT: "Payout paused. Funds remain reserved for a safe retry.",
          DISPUTE:
            "Issue reported. Payout is frozen until the case is resolved.",
          RESOLVE: "Case resolved. The delivery can continue.",
          UNASSIGN:
            "Assignment released. The funded delivery is available again.",
          REFUND: "Delivery cancelled. Simulated funds returned.",
          ATTEMPT: "Delivery attempt recorded. Payment remains locked.",
        }[action],
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Something went wrong.");
    }
  }
  function navigate(next: Page) {
    if (next === "Overview" && role === "Courier" && !venueSelected)
      courierLocation.locate();
    setPage(next);
    setMobileOpen(false);
    setQuery("");
    setFilter("All deliveries");
  }
  function switchWorkspace(nextRole: DemoRole) {
    if (nextRole === "Courier" && role !== "Courier" && !venueSelected)
      courierLocation.locate();
    setRole(nextRole);
    setRoleOpen(false);
    navigate("Overview");
    window.history.replaceState(
      window.history.state,
      "",
      nextRole === "Courier" ? "/courier" : "/",
    );
  }
  function pageLabel(label: Page) {
    if (role !== "Courier") return label;
    return {
      Overview: "Find deliveries",
      Deliveries: "My deliveries",
      Wallet: "Wallet",
      Activity: "Activity",
      Couriers: "Couriers",
    }[label];
  }
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setRoleOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => document.removeEventListener("keydown", handler);
  }, []);
  function downloadReport() {
    const quote = (value: string | number) =>
      `"${String(value).replaceAll('"', '""')}"`;
    const csv = [
      "Delivery,Description,Status,Fee (USDC),Payout address,Environment",
      ...workspaceJobs.map((j) =>
        [
          j.id,
          j.title,
          STATUS[j.status].label,
          j.fee,
          j.payoutWallet || "",
          "Simulated — no real funds",
        ]
          .map(quote)
          .join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "haulie-deliveries.csv";
    a.click();
    URL.revokeObjectURL(url);
    notify("Your delivery report has been downloaded.");
  }
  const courierMode = role === "Courier" && page === "Overview";
  const courierLocation = useCourierLocation(courierMode && !venueSelected);
  const mapLocation: CourierLocationState = venueSelected
    ? { status: "ready", point: TORANOMON_FORUM.point, accuracy: null }
    : courierLocation.location;
  function locateCourier() {
    setVenueSelected(false);
    courierLocation.locate();
  }
  function useForumLocation() {
    setVenueSelected(true);
    setVenueRevision((value) => value + 1);
  }
  const recipientMode = role === "Recipient" && page === "Overview";
  const operatorMode = role === "Operator" && page === "Overview";

  return (
    <div className={`app-shell${courierMode ? " map-workspace-shell" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside
        className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}
        aria-label="Main navigation"
      >
        <Link className="brand-link" href="/" aria-label="Haulie home">
          <Brand />
        </Link>
        <div className="workspace-wrap">
          <button
            className="workspace-button"
            onClick={() => setRoleOpen(!roleOpen)}
            aria-expanded={roleOpen}
          >
            <span className="workspace-icon">
              {role === "Courier" ? <Bike size={19} /> : <Store size={19} />}
            </span>
            <span>
              <strong>{role === "Merchant" ? state.businessName : role}</strong>
              <small>
                {role === "Courier" ? "Workspace" : `${role} account`}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
          {roleOpen && (
            <>
              <button
                className="dropdown-scrim"
                aria-label="Close workspace menu"
                onClick={() => setRoleOpen(false)}
              />
              <div className="role-menu">
                <p>Switch role</p>
                {ROLES.map((r) => (
                  <button key={r} onClick={() => switchWorkspace(r)}>
                    <span>{r}</span>
                    {r === role && <Check size={16} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <nav>
          {NAV.filter(
            (item) => role !== "Courier" || item.label !== "Couriers",
          ).map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${page === label ? "nav-active" : ""}`}
              onClick={() => navigate(label)}
              aria-current={page === label ? "page" : undefined}
            >
              <Icon size={20} />
              <span>{pageLabel(label)}</span>
              {label === "Deliveries" && (
                <span className="nav-count">{active.length}</span>
              )}
            </button>
          ))}
          {!courierMode && (
            <button
              className="nav-item"
              onClick={() => setDialog("connections")}
            >
              <Globe2 size={20} />
              <span>Connections</span>
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setDialog("guide")}>
            <CircleHelp size={20} />
            <span>Help</span>
            <ArrowUpRight size={15} />
          </button>
          <button className="nav-item" onClick={() => setDialog("settings")}>
            <Settings2 size={20} />
            <span>Settings</span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </button>
            {courierMode ? (
              <h1 className="courier-page-title">Find deliveries</h1>
            ) : (
              <>
                <span className="breadcrumb-parent">
                  Workspace <ChevronRight size={13} />
                </span>
                <span>{pageLabel(page)}</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {courierMode && (
              <button
                className="courier-city"
                onClick={locateCourier}
                aria-label="Use my current location"
              >
                <MapPin size={14} />{" "}
                {venueSelected || courierLocation.location.status !== "ready"
                  ? "Toranomon Hills Forum"
                  : "Near you"}
              </button>
            )}
            {!courierMode && (
              <label className="global-search">
                <Search size={16} />
                <input
                  ref={searchRef}
                  aria-label="Search deliveries"
                  placeholder="Search deliveries"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (page !== "Overview" && page !== "Deliveries")
                      setPage("Deliveries");
                  }}
                />
                <kbd>⌘ K</kbd>
              </label>
            )}

            <button
              className="icon-button bell-button"
              aria-label="View notifications"
              onClick={() => setDialog("notifications")}
            >
              <Bell size={19} />
              {state.notifications && <i />}
            </button>
          </div>
        </header>
        <main
          id="main-content"
          className={courierMode ? "courier-main" : undefined}
        >
          {!courierMode && (
            <section className="page-heading">
              <div>
                <h1>
                  {page === "Overview"
                    ? courierMode
                      ? "Find deliveries"
                      : recipientMode
                        ? "Incoming deliveries"
                        : operatorMode
                          ? "Operations"
                          : "Overview"
                    : pageLabel(page)}
                </h1>
              </div>
              <div className="heading-actions">
                {page === "Wallet" ? (
                  <button
                    className="button button-secondary"
                    onClick={downloadReport}
                  >
                    <ArrowDownToLine size={17} />
                    Export ledger
                  </button>
                ) : (
                  role === "Merchant" && (
                    <button
                      className="button button-primary"
                      onClick={() => setDialog("create")}
                    >
                      <Plus size={18} />
                      New delivery
                    </button>
                  )
                )}
              </div>
            </section>
          )}

          {courierMode && (
            <CourierWorkspace
              jobs={state.jobs}
              location={mapLocation}
              onLocate={locateCourier}
              venueSelected={venueSelected}
              onVenueSelect={useForumLocation}
              locationRevision={courierLocation.revision + venueRevision}
              resumeJobId={resumeJobId}
              onDetails={setSelected}
              onVerify={requestWorld}
              onWorldStatus={receiveWorldStatus}
              onWalletChange={setWalletAddress}
            />
          )}

          {page === "Overview" && role === "Merchant" && (
            <>
              <div className="stats-grid">
                <Stat
                  icon={Truck}
                  title="Active deliveries"
                  value={String(active.length).padStart(2, "0")}
                  tone="green"
                />
                <Stat
                  icon={CircleCheck}
                  title="Delivered"
                  value={String(paid.length).padStart(2, "0")}
                  tone="mint"
                />
                <Stat
                  icon={LockKeyhole}
                  title="Reserved fees"
                  value={formatMoney(reserved)}
                  unit="USDC"
                  tone="cream"
                />
                <Stat
                  icon={Wallet}
                  title="Courier fees paid"
                  value={formatMoney(paidTotal)}
                  unit="USDC"
                  tone="blue"
                />
              </div>
              <div className="overview-grid">
                <section className="card deliveries-card">
                  <div className="section-header">
                    <div>
                      <h2>
                        Recent deliveries{" "}
                        <span className="subtle-count">
                          {state.jobs.length}
                        </span>
                      </h2>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("Deliveries")}
                    >
                      View all <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <DeliveryTabs
                    filter={filter}
                    setFilter={setFilter}
                    active={active.length}
                  />
                  <DeliveryTable
                    jobs={displayJobs.slice(0, 5)}
                    onSelect={setSelected}
                  />
                  <div className="table-footer">
                    <span>
                      <span className="green-dot" /> Sample deliveries
                    </span>
                    <span>
                      Showing {Math.min(displayJobs.length, 5)} of{" "}
                      {displayJobs.length}
                    </span>
                  </div>
                </section>
                <section className="card live-card">
                  <div className="section-header">
                    <h2>Delivery map</h2>
                    <span className="live-label">
                      <span />
                      Area preview
                    </span>
                  </div>
                  <div className="map-container">
                    <DeliveryMap job={spotlight} />
                    <div className="map-location">
                      <MapPin size={12} />
                      {spotlight?.pickup || "Delivery area"}
                    </div>
                  </div>
                  {spotlight && (
                    <>
                      <div className="spotlight-heading">
                        <div>
                          <span className="mini-label">
                            IN FOCUS · {spotlight.id}
                          </span>
                          <h3>{spotlight.destination}</h3>
                        </div>
                      </div>
                      <div className="spotlight-courier">
                        <Avatar initials={spotlight.initials || "HC"} small />
                        <span>
                          <strong>
                            {spotlight.courier || "Finding a courier"}
                          </strong>
                          <small>
                            <ShieldCheck size={12} />
                            {spotlight.acceptVerified
                              ? "Verified for this delivery"
                              : "Fresh verification required"}
                          </small>
                        </span>
                        <button
                          className="round-arrow"
                          aria-label={`Track delivery ${spotlight.id}`}
                          onClick={() => setSelected(spotlight.id)}
                        >
                          <ArrowUpRight size={19} />
                        </button>
                      </div>
                    </>
                  )}
                </section>
              </div>
            </>
          )}

          {page === "Deliveries" && (
            <section className="card all-deliveries">
              <div className="section-header">
                <div>
                  <h2>
                    {role === "Courier" ? "My deliveries" : "Your deliveries"}{" "}
                    <span className="subtle-count">{workspaceJobs.length}</span>
                  </h2>
                </div>
                <button
                  className="button button-secondary button-small"
                  onClick={downloadReport}
                >
                  <ArrowDownToLine size={15} />
                  Export
                </button>
              </div>
              <div className="delivery-tools">
                <DeliveryTabs
                  filter={filter}
                  setFilter={setFilter}
                  active={active.length}
                  extended
                />
                <label className="date-filter">
                  <Clock3 size={14} />
                  <select
                    aria-label="Filter deliveries by date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                  >
                    <option>All time</option>
                    <option>Today</option>
                  </select>
                </label>
              </div>
              <DeliveryTable
                jobs={displayJobs}
                onSelect={setSelected}
                expanded
              />
              <div className="table-footer">
                <span>
                  {displayJobs.length}{" "}
                  {displayJobs.length === 1 ? "delivery" : "deliveries"}
                </span>
                <span>Fees in simulated USDC</span>
              </div>
            </section>
          )}

          {page === "Couriers" && (
            <>
              <div className="info-banner">
                <ShieldCheck size={20} />
                <p>
                  Sample courier profiles. Verification does not include
                  background checks.
                </p>
              </div>
              <div className="courier-grid">
                {[
                  {
                    name: "Jamie Chen",
                    initials: "JC",
                    area: "Toranomon & Shinbashi",
                    vehicle: "Bicycle",
                    deliveries: 142,
                  },
                  {
                    name: "Sam Rivera",
                    initials: "SR",
                    area: "Atago & Nishi-Shimbashi",
                    vehicle: "E-bike",
                    deliveries: 98,
                  },
                  {
                    name: "Taylor Kim",
                    initials: "TK",
                    area: "Kamiyacho & Shiba Park",
                    vehicle: "Bicycle",
                    deliveries: 116,
                  },
                  {
                    name: "Alex Morgan",
                    initials: "AM",
                    area: "Azabudai & Toranomon",
                    vehicle: "E-bike",
                    deliveries: 84,
                  },
                ].map((c) => (
                  <div className="card courier-card" key={c.name}>
                    <div className="courier-card-top">
                      <Avatar initials={c.initials} />
                      <span className="badge badge-green">
                        <span className="status-dot" />
                        Sample profile
                      </span>
                    </div>
                    <h3>{c.name}</h3>
                    <p>
                      <MapPin size={14} />
                      {c.area}
                    </p>
                    <span className="courier-verification">
                      <ShieldCheck size={15} />
                      Test verification
                    </span>
                    <div className="courier-card-stats">
                      <span>
                        <Bike size={16} />
                        {c.vehicle}
                      </span>
                      <span>{c.deliveries} sample deliveries</span>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => {
                        setQuery(c.name);
                        setFilter("All deliveries");
                        setPage("Deliveries");
                      }}
                    >
                      View deliveries <ArrowUpRight size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {recipientMode && (
            <section className="card">
              <div className="section-header">
                <h2>Incoming parcels</h2>
                <span className="badge badge-muted">Recipient</span>
              </div>
              <div className="info-banner inset-info">
                <Package size={19} />
                <p>Select a parcel to confirm receipt.</p>
              </div>
              <DeliveryTable
                jobs={state.jobs.filter((j) =>
                  [
                    "PICKED_UP",
                    "DELIVERY_CONFIRMED",
                    "PAID",
                    "DISPUTED",
                  ].includes(j.status),
                )}
                onSelect={setSelected}
              />
            </section>
          )}

          {operatorMode && (
            <>
              <div className="stats-grid operator-stats">
                <Stat
                  icon={CircleHelp}
                  title="Open cases"
                  value={String(
                    state.jobs.filter((j) => j.status === "DISPUTED").length,
                  )}
                  tone="cream"
                />
                <Stat
                  icon={Clock3}
                  title="Payout retries"
                  value={String(
                    state.jobs.filter((j) => j.status === "PAYOUT_RETRY")
                      .length,
                  )}
                  tone="blue"
                />
                <Stat
                  icon={CheckCheck}
                  title="Confirmed deliveries"
                  value={String(
                    state.jobs.filter((j) => j.status === "DELIVERY_CONFIRMED")
                      .length,
                  )}
                  tone="green"
                />
              </div>
              <section className="card">
                <div className="section-header">
                  <h2>Exceptions & settlement</h2>
                  <span className="badge badge-muted">Operator</span>
                </div>
                <DeliveryTable
                  jobs={state.jobs.filter((j) =>
                    ["DISPUTED", "PAYOUT_RETRY", "DELIVERY_CONFIRMED"].includes(
                      j.status,
                    ),
                  )}
                  onSelect={setSelected}
                />
              </section>
            </>
          )}

          {page === "Wallet" && (
            <>
              <SuiWallet />
              <details className="demo-ledger">
                <summary>
                  Delivery ledger <span>Simulated USDC</span>
                  <ChevronDown size={16} />
                </summary>
                <div className="wallet-grid">
                  <section className="balance-card">
                    <div className="balance-heading">
                      <span>
                        <Wallet size={19} />
                        {role === "Courier"
                          ? "Simulated earnings"
                          : "Simulated balance"}
                      </span>
                      <span className="network-tag">
                        <span />
                        SIMULATED
                      </span>
                    </div>
                    <span className="balance-label">
                      {role === "Courier"
                        ? "Total earned"
                        : "Available balance"}
                    </span>
                    <div className="big-balance">
                      {formatMoney(
                        role === "Courier"
                          ? paidTotal
                          : Math.max(0, 250 - reserved - paidTotal),
                      )}
                      <span>USDC</span>
                    </div>
                    <p>
                      {role === "Courier"
                        ? "Simulated courier payouts."
                        : "For sample deliveries."}
                    </p>
                  </section>
                  <section className="card wallet-summary">
                    <h2>Delivery fees</h2>
                    <div>
                      <span className="wallet-summary-icon">
                        <LockKeyhole size={20} />
                      </span>
                      <span>
                        <strong>Reserved in escrow</strong>
                        <small>
                          Held for {active.length} active deliveries
                        </small>
                      </span>
                      <b>
                        {formatMoney(reserved)} <small>USDC</small>
                      </b>
                    </div>
                    <div>
                      <span className="wallet-summary-icon">
                        <ArrowUpRight size={20} />
                      </span>
                      <span>
                        <strong>
                          {role === "Courier"
                            ? "Paid to you"
                            : "Paid to couriers"}
                        </strong>
                        <small>After recipient confirmation</small>
                      </span>
                      <b>
                        {formatMoney(paidTotal)} <small>USDC</small>
                      </b>
                    </div>
                    <p>
                      <ShieldCheck size={14} />
                      Simulated funds · no on-chain payments.
                    </p>
                  </section>
                </div>
                <section className="card">
                  <div className="section-header">
                    <div>
                      <h2>Payment history</h2>
                    </div>
                    <span className="badge badge-muted">Simulated USDC</span>
                  </div>
                  <div className="payment-list">
                    {workspaceJobs.map((j) => (
                      <button
                        key={j.id}
                        className="payment-row"
                        onClick={() => setSelected(j.id)}
                      >
                        <span
                          className={`payment-icon ${j.status === "PAID" ? "payment-out" : ""}`}
                        >
                          {j.status === "PAID" ? (
                            <ArrowUpRight size={19} />
                          ) : j.status === "REFUNDED" ? (
                            <ArrowDownLeft size={19} />
                          ) : (
                            <LockKeyhole size={17} />
                          )}
                        </span>
                        <span className="payment-title">
                          <strong>
                            {j.status === "PAID"
                              ? "Courier payout"
                              : j.status === "REFUNDED"
                                ? "Escrow refunded"
                                : "Delivery escrow"}
                          </strong>
                          <small>
                            {j.id} · {j.title}
                          </small>
                        </span>
                        <span className="payment-status">
                          {j.status === "PAID"
                            ? "Completed"
                            : j.status === "REFUNDED"
                              ? "Returned"
                              : j.status === "DISPUTED"
                                ? "Frozen"
                                : "Reserved"}
                        </span>
                        <strong>
                          {formatMoney(j.fee)} <small>USDC</small>
                        </strong>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </div>
                </section>
              </details>
            </>
          )}

          {page === "Activity" && (
            <section className="card activity-card">
              <div className="section-header">
                <div>
                  <h2>Delivery activity</h2>
                </div>
                <button
                  className="button button-secondary button-small"
                  onClick={downloadReport}
                >
                  <ArrowDownToLine size={15} />
                  Export deliveries
                </button>
              </div>
              <div className="activity-list">
                {workspaceJobs
                  .flatMap((j) =>
                    j.events.map((event, index) => ({
                      ...event,
                      job: j,
                      key: `${j.id}-${index}`,
                    })),
                  )
                  .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
                  .slice(0, 40)
                  .map((e) => (
                    <button
                      className="activity-row"
                      key={e.key}
                      onClick={() => setSelected(e.job.id)}
                    >
                      <span className="activity-icon">
                        <Check size={15} />
                      </span>
                      <span>
                        <strong>{e.title}</strong>
                        <small>
                          {e.actor} <span>·</span> {e.job.id} <span>·</span>{" "}
                          {e.job.title}
                        </small>
                      </span>
                      <time suppressHydrationWarning>
                        {new Date(e.at).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
              </div>
            </section>
          )}
        </main>
      </div>

      {selectedJob && (
        <DeliveryDetail
          key={selectedJob.id}
          job={selectedJob}
          initialRole={role}
          acceptanceReady={role === "Courier" ? true : acceptanceReady}
          onWorldVerification={role === "Courier" ? requestWorld : undefined}
          onClose={() => {
            setSelected(null);
          }}
          onAction={updateJob}
          notify={notify}
        />
      )}
      {worldAction && state.jobs.find((job) => job.id === worldAction.id) && (
        <WorldActionDialog
          job={state.jobs.find((job) => job.id === worldAction.id)!}
          stage={worldAction.stage}
          status={worldStatus}
          wallet={walletAddress}
          onWalletChange={setWalletAddress}
          onUpdated={async () => {
            await refreshWorld();
            setResumeJobId(worldAction.id);
            setWorldAction(null);
          }}
          onClose={() => setWorldAction(null)}
        />
      )}
      {dialog === "connections" && (
        <Modal title="Connections" onClose={() => setDialog(null)}>
          <WorkspaceConnections
            onVerify={() => router.push("/world-sandbox")}
            onStatus={receiveWorldStatus}
            onWalletChange={setWalletAddress}
          />
        </Modal>
      )}
      {dialog === "create" && (
        <CreateDelivery
          available={Math.max(0, 250 - reserved - paidTotal)}
          onClose={() => setDialog(null)}
          onCreate={(job) => {
            save({ ...state, jobs: [job, ...state.jobs] });
            setDialog(null);
            setSelected(job.id);
            notify("Delivery created. Fee reserved.");
          }}
        />
      )}
      {dialog === "guide" && (
        <Modal
          title="How it works"
          subtitle="Delivery workflow"
          onClose={() => setDialog(null)}
        >
          <div className="guide-steps">
            {[
              {
                icon: LockKeyhole,
                title: "Fund it first",
                text: "Create a delivery and reserve the fee.",
              },
              {
                icon: ShieldCheck,
                title: "Verify the courier",
                text: "The courier verifies at acceptance and pickup.",
              },
              {
                icon: Package,
                title: "Confirm handoffs",
                text: "The merchant confirms pickup; the recipient confirms receipt.",
              },
              {
                icon: Wallet,
                title: "Release payment",
                text: "Pay the assigned courier after confirmed delivery.",
              },
            ].map(({ icon: Icon, title, text }, i) => (
              <div key={title}>
                <span className="guide-number">0{i + 1}</span>
                <Icon size={20} />
                <span>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </span>
              </div>
            ))}
          </div>
          <div className="notice">
            <Sparkles size={19} />
            <p>
              Deliveries and payouts are simulated. World verification and the
              Sui testnet wallet are connected in the courier workspace.
            </p>
          </div>

          <button
            className="button button-primary full-width"
            onClick={() => {
              setDialog(null);
              switchWorkspace("Courier");
            }}
          >
            Explore the courier workspace <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {dialog === "notifications" && (
        <Modal
          title="Notifications"

          onClose={() => setDialog(null)}
        >
          <div className="notification-list">
            {active.slice(0, 4).map((j) => (
              <button
                key={j.id}
                onClick={() => {
                  setDialog(null);
                  setSelected(j.id);
                }}
              >
                <span className="activity-icon">
                  <Package size={19} />
                </span>
                <span>
                  <strong>{j.title}</strong>
                  <small>
                    {j.id} · {STATUS[j.status].label}
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {dialog === "settings" && (
        <SettingsModal
          state={state}
          save={save}
          notify={notify}
          onClose={() => setDialog(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={20} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  title,
  value,
  unit,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  unit?: string;
  tone: string;
}) {
  return (
    <section className="card stat-card">
      <div className="stat-top">
        <span>{title}</span>
        <span className={`stat-icon stat-${tone}`}>
          <Icon size={17} />
        </span>
      </div>
      <div className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
    </section>
  );
}
function DeliveryTabs({
  filter,
  setFilter,
  active,
  extended = false,
}: {
  filter: string;
  setFilter: (f: string) => void;
  active: number;
  extended?: boolean;
}) {
  return (
    <div className="delivery-tabs" role="group" aria-label="Delivery status">
      {[
        "All deliveries",
        "Active",
        "Completed",
        ...(extended ? ["Needs attention"] : []),
      ].map((f) => (
        <button
          aria-pressed={filter === f}
          key={f}
          className={filter === f ? "tab-active" : ""}
          onClick={() => setFilter(f)}
        >
          {f}
          {f === "Active" && <span>{active}</span>}
        </button>
      ))}
    </div>
  );
}
function DeliveryTable({
  jobs,
  onSelect,
  expanded = false,
}: {
  jobs: DemoJob[];
  onSelect: (id: string) => void;
  expanded?: boolean;
}) {
  return jobs.length ? (
    <div className="table-scroll">
      <table className={`delivery-table ${expanded ? "table-expanded" : ""}`}>
        <thead>
          <tr>
            <th>DELIVERY</th>
            <th>DESTINATION</th>
            <th>COURIER</th>
            <th>STATUS</th>
            {expanded && <th>FEE</th>}
            <th>
              <span className="sr-only">Open delivery</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} onClick={() => onSelect(j.id)}>
              <td>
                <div className="delivery-cell">
                  <span
                    className={`package-thumb thumb-${j.category === "Flowers & plants" ? "pink" : j.category === "Packaged food" ? "peach" : j.category === "Books & stationery" ? "blue" : "green"}`}
                  >
                    {j.category === "Flowers & plants" ? (
                      <Leaf size={20} />
                    ) : j.category === "Books & stationery" ? (
                      <FileText size={20} />
                    ) : (
                      <Package size={20} />
                    )}
                  </span>
                  <span>
                    <button
                      className="delivery-id"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(j.id);
                      }}
                      aria-label={`View delivery ${j.id}`}
                    >
                      {j.id}
                    </button>
                    <small>{j.category}</small>
                  </span>
                </div>
              </td>
              <td>
                <span className="destination-name">{j.destination}</span>
                <small>From {j.pickup}</small>
              </td>
              <td>
                {j.courier ? (
                  <div className="courier-cell">
                    <Avatar initials={j.initials!} small />
                    <span>
                      {j.courier.split(" ")[0]}{" "}
                      {j.courier.split(" ")[1]?.charAt(0)}.
                      <ShieldCheck size={12} />
                    </span>
                  </div>
                ) : (
                  <span className="assigning">
                    <span />
                    Finding a match
                  </span>
                )}
              </td>
              <td>
                <StatusBadge job={j} />
              </td>
              {expanded && (
                <td>
                  <strong className="table-fee">
                    {formatMoney(j.fee)} <small>USDC</small>
                  </strong>
                </td>
              )}
              <td>
                <ArrowUpRight className="row-arrow" size={16} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <EmptyState
      title="No deliveries"
      text="Try another filter or create a delivery."
    />
  );
}

function CreateDelivery({
  onClose,
  onCreate,
  available,
}: {
  onClose: () => void;
  onCreate: (job: DemoJob) => void;
  available: number;
}) {
  const [fee, setFee] = useState("6.00");
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Record<string, string>>({
    pickupArea: TORANOMON_FORUM.name,
    pickupAddress: TORANOMON_FORUM.address,
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    setDraft(data);
    setStep(2);
  }
  function create() {
    if (Number(fee) > available || Number(fee) < 1) return;
    const now = new Date().toISOString();
    const id = `HL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    onCreate({
      id,
      title: draft.title,
      category: draft.category,
      pickup: draft.pickupArea,
      destination: draft.destinationArea,
      pickupAddress: draft.pickupAddress,
      destinationAddress: draft.destinationAddress,
      recipient: draft.recipient,
      fee: Math.round(Number(fee) * 100) / 100,
      status: "FUNDED",
      window: draft.window,
      createdAt: now,
      events: [
        { title: "Delivery created", actor: "Merchant", at: now },
        { title: "Simulated fee reserved", actor: "Merchant", at: now },
      ],
    });
  }
  return (
    <Modal
      title={step === 1 ? "New delivery" : "Review delivery"}
      subtitle={`NEW DELIVERY · STEP ${step} OF 2`}
      onClose={onClose}
    >
      <div className="form-steps">
        <span className="form-step-active" />
        <span className={step === 2 ? "form-step-active" : ""} />
      </div>
      {step === 1 ? (
        <form onSubmit={submit} className="delivery-form">
          <label>
            What are we delivering?
            <input
              name="title"
              placeholder="e.g. A care package for Jamie"
              required
              maxLength={80}
              defaultValue={draft.title}
            />
          </label>
          <div className="form-row">
            <label>
              Parcel category
              <select
                name="category"
                defaultValue={draft.category || "Small parcel"}
              >
                <option>Small parcel</option>
                <option>Flowers & plants</option>
                <option>Books & stationery</option>
                <option>Packaged food</option>
                <option>Gifts</option>
              </select>
            </label>
            <label>
              Delivery window
              <select
                name="window"
                defaultValue={draft.window || "Within 1 hour"}
              >
                <option>Within 1 hour</option>
                <option>Within 2 hours</option>
                <option>Today, before 6 PM</option>
              </select>
            </label>
          </div>
          <div className="form-section-label">
            <span className="route-dot" />
            PICKUP
          </div>
          <div className="form-row">
            <label>
              Pickup address
              <input
                name="pickupAddress"
                placeholder="Toranomon Hills Mori Tower 5F, 1-23-3 Toranomon"
                required
                defaultValue={draft.pickupAddress}
              />
            </label>
            <label>
              Neighborhood
              <input
                name="pickupArea"
                placeholder="Toranomon Hills Forum"
                required
                defaultValue={draft.pickupArea}
              />
            </label>
          </div>
          <div className="form-section-label">
            <span className="route-dot route-dot-destination" />
            DROP-OFF
          </div>
          <div className="form-row">
            <label>
              Delivery address
              <input
                name="destinationAddress"
                placeholder="Toranomon 5-chome, Minato-ku, Tokyo"
                required
                defaultValue={draft.destinationAddress}
              />
            </label>
            <label>
              Neighborhood
              <input
                name="destinationArea"
                placeholder="Kamiyacho"
                required
                defaultValue={draft.destinationArea}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Recipient name
              <input
                name="recipient"
                placeholder="Jamie Lee"
                required
                defaultValue={draft.recipient}
              />
            </label>
            <label>
              Courier fee (USDC)
              <input
                name="fee"
                type="number"
                min="1"
                max={Math.min(50, available)}
                step="0.01"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                required
              />
            </label>
          </div>
          <p className="fine-print">
            {formatMoney(available)} simulated USDC available.
          </p>
          <button type="submit" className="button button-primary full-width">
            Review delivery <ArrowRight size={17} />
          </button>
        </form>
      ) : (
        <div className="review-delivery">
          <span className="review-package">
            <Package size={32} />
          </span>
          <h3>{draft.title}</h3>
          <p>
            {draft.category} · {draft.window}
          </p>
          <div className="review-route">
            <div>
              <span className="route-dot" />
              <span>
                <small>PICKUP</small>
                <strong>{draft.pickupAddress}</strong>
                <span>{draft.pickupArea}</span>
              </span>
            </div>
            <div>
              <span className="route-dot route-dot-destination" />
              <span>
                <small>DROP-OFF · {draft.recipient}</small>
                <strong>{draft.destinationAddress}</strong>
                <span>{draft.destinationArea}</span>
              </span>
            </div>
          </div>
          <div className="review-total">
            <span>Courier fee</span>
            <strong>
              {formatMoney(Number(fee))} <small>USDC</small>
            </strong>
          </div>
          <div className="notice">
            <LockKeyhole size={18} />
            <p>Simulated fee. Cancel before assignment for a full refund.</p>
          </div>
          <div className="modal-actions">
            <button
              className="button button-secondary"
              onClick={() => setStep(1)}
            >
              <ChevronLeft size={16} />
              Back
            </button>
            <button className="button button-primary" onClick={create}>
              Create delivery <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
function SettingsModal({
  state,
  save,
  notify,
  onClose,
}: {
  state: DemoState;
  save: (s: DemoState) => void;
  notify: (m: string) => void;
  onClose: () => void;
}) {
  const [resetConfirm, setResetConfirm] = useState(false);
  return (
    <Modal title="Settings" subtitle="Workspace settings" onClose={onClose}>
      <form
        className="delivery-form"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          save({
            ...state,
            businessName: String(data.get("business")),
            contact: String(data.get("email")),
            notifications: data.get("notifications") === "on",
          });
          notify("Your workspace settings have been saved.");
          onClose();
        }}
      >
        <label>
          Business name
          <input
            name="business"
            defaultValue={state.businessName}
            required
            maxLength={40}
          />
        </label>
        <label>
          Contact email
          <input
            name="email"
            type="email"
            defaultValue={state.contact}
            required
          />
        </label>
        <label className="checkbox-label">
          <input
            name="notifications"
            type="checkbox"
            defaultChecked={state.notifications}
          />
          <span>
            Show delivery notification indicator
            <small>Workspace alerts. No emails are sent.</small>
          </span>
        </label>
        <div className="settings-network">
          <span>
            <Globe2 size={18} />
            Environment
          </span>
          <strong>Test workspace</strong>
        </div>
        <button className="button button-primary full-width" type="submit">
          Save changes <Check size={16} />
        </button>
      </form>
      <div className="reset-section">
        <div>
          <strong>Start fresh</strong>
          <p>Reset sample deliveries and workspace preferences.</p>
        </div>
        <button
          className="button button-secondary button-small"
          onClick={() => {
            if (!resetConfirm) {
              setResetConfirm(true);
              return;
            }
            save(structuredClone(INITIAL_STATE));
            notify("Workspace reset.");
            onClose();
          }}
        >
          {resetConfirm ? "Confirm reset" : "Reset workspace"}
        </button>
      </div>
    </Modal>
  );
}
