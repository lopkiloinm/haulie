"use client";

import Link from "next/link";
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
  History,
  LayoutDashboard,
  Leaf,
  LockKeyhole,
  MapPin,
  Menu,
  MoreHorizontal,
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
import { ParcelArt } from "./parcel-art";
import { DeliveryDetail, Modal } from "./delivery-detail";
import {
  DEMO_COURIER,
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
  "create" | "guide" | "notifications" | "settings" | "wallet" | null;
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
  const snapshot = useSyncExternalStore(
    subscribeDemo,
    readSnapshot,
    () => INITIAL_SNAPSHOT,
  );
  const state = useMemo(() => parseSnapshot(snapshot), [snapshot]);
  const [page, setPage] = useState<Page>("Overview");
  const [role, setRole] = useState<DemoRole>(initialRole);
  const [roleOpen, setRoleOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [startAcceptance, setStartAcceptance] = useState(false);
  const [filter, setFilter] = useState("All deliveries");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [dateFilter, setDateFilter] = useState("All time");
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedJob = state.jobs.find((j) => j.id === selected);
  const workspaceJobs =
    role === "Courier" ? state.jobs.filter(isOwnCourierJob) : state.jobs;
  const availableJobs = state.jobs.filter(
    (j) => j.status === "FUNDED" && !j.courier,
  );
  const availableMatches = availableJobs.filter((j) =>
    `${j.title} ${j.id} ${j.pickup} ${j.destination} ${j.category}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const acceptanceReady = state.courierEnrolled && state.walletConnected;
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
        "Browser storage is unavailable. Please enable it to save demo changes.",
      );
    }
  }
  function updateJob(id: string, action: DemoAction, reason?: string) {
    try {
      const current = parseSnapshot(readSnapshot());
      const target = current.jobs.find((j) => j.id === id);
      if (!target) throw new Error("Delivery not found.");
      if (
        action === "ACCEPT" &&
        (!current.courierEnrolled || !current.walletConnected)
      )
        throw new Error(
          "Complete demo enrollment and connect the demo wallet first.",
        );
      const next = transitionJob(target, action, reason);
      save({
        ...current,
        jobs: current.jobs.map((j) => (j.id === id ? next : j)),
      });
      notify(
        {
          ACCEPT: "Delivery accepted. A new pickup check will be required.",
          VERIFY_PICKUP:
            "Pickup check complete. The merchant can now confirm handoff.",
          HANDOFF: "Parcel handed over. Your delivery is on the way.",
          CONFIRM_RECEIPT:
            "Receipt confirmed. The demo payout is ready to process.",
          PAY: "Demo payout complete. No real funds were transferred.",
          FAIL_PAYOUT: "Payout paused. Funds remain reserved for a safe retry.",
          DISPUTE:
            "Issue reported. Payout is frozen until the case is resolved.",
          RESOLVE: "Case resolved. The delivery can continue.",
          UNASSIGN:
            "Assignment released. The funded delivery is available again.",
          REFUND: "Delivery cancelled. Demo funds returned.",
          ATTEMPT: "Delivery attempt recorded. Payment remains locked.",
        }[action],
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Something went wrong.");
    }
  }
  function navigate(next: Page) {
    setPage(next);
    setMobileOpen(false);
    setQuery("");
    setFilter("All deliveries");
  }
  function switchWorkspace(nextRole: DemoRole) {
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
      Wallet: "Earnings",
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
          "Demo — no real funds",
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
    a.download = "haulie-demo-deliveries.csv";
    a.click();
    URL.revokeObjectURL(url);
    notify("Your delivery report has been downloaded.");
  }
  const courierMode = role === "Courier" && page === "Overview";
  const recipientMode = role === "Recipient" && page === "Overview";
  const operatorMode = role === "Operator" && page === "Overview";

  return (
    <div className="app-shell">
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
              <strong>
                {role === "Merchant" ? state.businessName : `${role} workspace`}
              </strong>
              <small>{role} account</small>
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
                <p>EXPLORE THE DEMO AS</p>
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
        <span className="nav-caption">WORKSPACE</span>
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
              {page === label && label !== "Deliveries" && (
                <span className="nav-active-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <div className="note-icon">
              <ShieldCheck size={22} />
              <span className="little-spark">✦</span>
            </div>
            <strong>
              Real humans.
              <br />
              Better deliveries.
            </strong>
            <p>A fresh check at every handoff. That’s the Haulie way.</p>
            <button onClick={() => setDialog("guide")}>
              Get to know Haulie <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="nav-item" onClick={() => setDialog("guide")}>
            <CircleHelp size={20} />
            <span>Help & getting started</span>
            <ArrowUpRight size={15} />
          </button>
          <button className="nav-item" onClick={() => setDialog("settings")}>
            <Settings2 size={20} />
            <span>Settings</span>
          </button>
          <button className="profile" onClick={() => setDialog("settings")}>
            <Avatar
              initials={role === "Courier" ? DEMO_COURIER.initials : "AL"}
            />
            <span>
              <strong>
                {role === "Courier" ? DEMO_COURIER.name : "Alex Lee"}
              </strong>
              <small>
                {role === "Courier" ? "Courier · demo" : "Business owner"}
              </small>
            </span>
            <MoreHorizontal size={18} />
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
            <span className="breadcrumb-parent">
              Workspace <ChevronRight size={13} />
            </span>
            <span>{pageLabel(page)}</span>
          </div>
          <div className="topbar-actions">
            <Link
              className="workspace-shortcut"
              aria-label={
                role === "Courier" ? "Merchant workspace" : "Courier workspace"
              }
              href={role === "Courier" ? "/" : "/courier"}
            >
              {role === "Courier" ? <Store size={15} /> : <Bike size={15} />}
              {role === "Courier" ? "Merchant" : "Courier"}
              <span className="workspace-shortcut-suffix">workspace</span>
              <ArrowUpRight size={13} />
            </Link>
            <label className="global-search">
              <Search size={16} />
              <input
                ref={searchRef}
                aria-label="Search deliveries"
                placeholder="Search anything..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (page !== "Overview" && page !== "Deliveries")
                    setPage("Deliveries");
                }}
              />
              <kbd>⌘ K</kbd>
            </label>
            <button className="demo-badge" onClick={() => setDialog("guide")}>
              <span />
              Demo <b className="demo-workspace-word">workspace</b>
            </button>
            <span className="topbar-divider" />
            <button
              className="icon-button bell-button"
              aria-label="View notifications"
              onClick={() => setDialog("notifications")}
            >
              <Bell size={19} />
              {state.notifications && <i />}
            </button>
            <button
              className="top-avatar"
              onClick={() => setDialog("settings")}
              aria-label="Account settings"
            >
              <Avatar
                initials={role === "Courier" ? DEMO_COURIER.initials : "AL"}
                small
              />
            </button>
          </div>
        </header>
        <main id="main-content">
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="sun-icon">☀</span>
                {page === "Overview"
                  ? "YOUR NEIGHBORHOOD, DELIVERED"
                  : "THE EVERYDAY DETAILS"}
              </div>
              <h1>
                {courierMode
                  ? "Your next delivery awaits."
                  : recipientMode
                    ? "Something good is on its way."
                    : operatorMode
                      ? "Keep every handoff moving."
                      : page === "Overview"
                        ? "A good day to deliver."
                        : page === "Deliveries"
                          ? role === "Courier"
                            ? "Your deliveries. Your next steps."
                            : "Every delivery. All right here."
                          : page === "Couriers"
                            ? "Good people, going places."
                            : page === "Wallet"
                              ? role === "Courier"
                                ? "Your deliveries, paid off."
                                : "A little clarity for your balance."
                              : "Every step, accounted for."}
              </h1>
              <p>
                {courierMode
                  ? "Find a local delivery, verify for the job, and make someone’s day."
                  : recipientMode
                    ? "Track your parcel and confirm when it’s safely in your hands."
                    : operatorMode
                      ? "Review exceptions and help deliveries get back on track."
                      : page === "Overview"
                        ? "Here’s what’s moving with your business today, Alex."
                        : page === "Deliveries"
                          ? "From the first pickup to the final doorstep. Stay in the loop."
                          : page === "Couriers"
                            ? "Meet the unique-human verified couriers in your neighborhood."
                            : page === "Wallet"
                              ? "Funds reserved before pickup. Courier payment after confirmed delivery."
                              : "A clear trail of verifications, handoffs, and payments."}
              </p>
            </div>
            <div className="heading-actions">
              {page === "Wallet" ? (
                <button
                  className="button button-secondary"
                  onClick={downloadReport}
                >
                  <ArrowDownToLine size={17} />
                  Export statement
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

          {page === "Overview" && role === "Merchant" && (
            <>
              <section className="welcome-banner">
                <div className="welcome-copy">
                  <span className="mini-label">
                    <span /> A LITTLE LOCAL. A LOT OF TRUST.
                  </span>
                  <h2>
                    Big on care.
                    <br />
                    Light on your to-do list.
                  </h2>
                  <p>
                    A verified human at every handoff.
                    <br className="mobile-break" /> Payment ready at delivery.
                  </p>
                  <button onClick={() => setDialog("guide")}>
                    See how Haulie works <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="hero-art">
                  <ParcelArt />
                </div>
                <span className="banner-annotation">
                  <span className="drawn-arrow">↙</span> a little peace of mind,
                  <br /> in every parcel
                </span>
              </section>
              <div className="stats-grid">
                <Stat
                  icon={Truck}
                  title="Active deliveries"
                  value={String(active.length).padStart(2, "0")}
                  note="A few good things on the move"
                  trend="Live overview"
                  tone="green"
                />
                <Stat
                  icon={CircleCheck}
                  title="Successfully delivered"
                  value={String(paid.length).padStart(2, "0")}
                  note="Made it into the right hands"
                  trend="Confirmed handoffs"
                  tone="mint"
                />
                <Stat
                  icon={LockKeyhole}
                  title="Funds in escrow"
                  value={formatMoney(reserved)}
                  unit="USDC"
                  note="Reserved for your couriers"
                  tone="cream"
                />
                <Stat
                  icon={Wallet}
                  title="Courier fees paid"
                  value={formatMoney(paidTotal)}
                  unit="USDC"
                  note="After a confirmed delivery"
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
                      <p>Small journeys. Real-time peace of mind.</p>
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
                      <span className="green-dot" /> Your demo workspace is up
                      to date
                    </span>
                    <span>
                      Showing {Math.min(displayJobs.length, 5)} of{" "}
                      {displayJobs.length}
                    </span>
                  </div>
                </section>
                <section className="card live-card">
                  <div className="section-header">
                    <h2>Around the neighborhood</h2>
                    <span className="live-label">
                      <span />
                      LIVE DEMO
                    </span>
                  </div>
                  <div className="map-container">
                    <DeliveryMap stage={spotlight?.status} />
                    <div className="map-location">
                      <MapPin size={12} />
                      San Francisco, CA
                    </div>
                    <div className="map-floating-badge">
                      <Bike size={16} />
                      <span>Good things are moving</span>
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
                        <span className="eta">
                          <Clock3 size={13} />
                          {spotlight.status === "PICKED_UP"
                            ? "~12 min"
                            : "Pending"}
                        </span>
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
              <section className="trust-strip">
                <span className="trust-emblem">
                  <ShieldCheck size={25} />
                </span>
                <div className="trust-heading">
                  <h3>Trust, at every turn.</h3>
                  <p>Good deliveries have a clear path.</p>
                </div>
                <div className="trust-steps">
                  <span>
                    <LockKeyhole size={15} />
                    Funds reserved
                  </span>
                  <ChevronRight size={13} />
                  <span>
                    <ShieldCheck size={15} />
                    Freshly verified
                  </span>
                  <ChevronRight size={13} />
                  <span>
                    <Package size={15} />
                    Handoff confirmed
                  </span>
                  <ChevronRight size={13} />
                  <span>
                    <CircleCheck size={15} />
                    Courier paid
                  </span>
                </div>
              </section>
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
                  <p>Every parcel has a story. Follow yours.</p>
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
                <span>All fees shown in demo USDC</span>
              </div>
            </section>
          )}

          {(courierMode || page === "Couriers") && (
            <>
              {courierMode && (
                <section className="courier-readiness card">
                  <div className="readiness-icon">
                    <ShieldCheck size={26} />
                  </div>
                  <div>
                    <h3>
                      {acceptanceReady
                        ? "You’re ready for your next journey."
                        : state.courierEnrolled
                          ? "Connect your demo payout wallet."
                          : "Start with your unique-human check."}
                    </h3>
                    <p>
                      {state.courierEnrolled
                        ? "Enrollment is complete. Each delivery still needs a fresh check."
                        : "Demo enrollment establishes a session for future delivery checks."}
                    </p>
                  </div>
                  <div className="readiness-actions">
                    <button
                      className="button button-secondary button-small"
                      onClick={() => {
                        save({
                          ...state,
                          courierEnrolled: !state.courierEnrolled,
                        });
                        notify(
                          state.courierEnrolled
                            ? "Demo enrollment reset."
                            : "Demo enrollment complete. No World ID proof was requested.",
                        );
                      }}
                    >
                      {state.courierEnrolled ? (
                        <>
                          <Check size={15} />
                          Demo enrolled
                        </>
                      ) : (
                        "Try demo enrollment"
                      )}
                    </button>
                    <button
                      className="button button-secondary button-small"
                      onClick={() => {
                        save({
                          ...state,
                          walletConnected: !state.walletConnected,
                        });
                        notify(
                          state.walletConnected
                            ? "Demo wallet disconnected."
                            : "Demo payout wallet connected.",
                        );
                      }}
                    >
                      <Wallet size={15} />
                      {state.walletConnected
                        ? "Demo wallet connected"
                        : "Connect demo wallet"}
                    </button>
                  </div>
                </section>
              )}
              {courierMode ? (
                <>
                  <div className="section-title">
                    <h2>Available deliveries</h2>
                    <span>{availableJobs.length} funded {availableJobs.length === 1 ? "offer" : "offers"}</span>
                  </div>
                  <div className="marketplace-tools">
                    <label className="marketplace-search">
                      <Search size={17} />
                      <input
                        type="search"
                        aria-label="Search available deliveries"
                        placeholder="Search by neighborhood, parcel, or reference"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    <span>
                      <LockKeyhole size={14} />
                      Only funded, unassigned deliveries
                    </span>
                  </div>
                  {!acceptanceReady && (
                    <div className="notice courier-setup-notice">
                      <ShieldCheck size={18} />
                      <p>
                        Complete demo enrollment and connect your demo payout
                        wallet above before accepting a delivery.
                      </p>
                    </div>
                  )}
                  <div className="offer-grid">
                    {availableMatches.map((j) => (
                      <article
                        className="card offer-card"
                        aria-label={j.title}
                        key={j.id}
                      >
                        <div className="offer-top">
                          <span className="category-icon">
                            <Package size={22} />
                          </span>
                          <span className="badge badge-green">
                            <LockKeyhole size={12} />
                            Demo funds reserved
                          </span>
                        </div>
                        <span className="mini-label">
                          {j.id} · {j.category}
                        </span>
                        <h3>{j.title}</h3>
                        <div className="offer-route">
                          <span>
                            <i />
                            {j.pickup}
                          </span>
                          <span>
                            <i />
                            {j.destination}
                          </span>
                        </div>
                        <div className="offer-bottom">
                          <span>
                            <strong>{formatMoney(j.fee)}</strong> USDC
                            <small>{j.window}</small>
                          </span>
                        </div>
                        <p className="offer-policy">
                          Fresh verification to accept and at pickup. Cancel
                          before pickup to release the assignment.
                        </p>
                        <div className="offer-actions">
                          <button
                            className="button button-secondary button-small"
                            onClick={() => setSelected(j.id)}
                          >
                            View details
                          </button>
                          <button
                            className="button button-primary button-small"
                            disabled={!acceptanceReady}
                            onClick={() => {
                              setStartAcceptance(true);
                              setSelected(j.id);
                            }}
                          >
                            Accept delivery <ArrowRight size={15} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {availableMatches.length === 0 && (
                    <div className="card">
                      <EmptyState
                        title={
                          query
                            ? "No matching deliveries."
                            : "You’re all caught up."
                        }
                        text={
                          query
                            ? "Try a different neighborhood or clear your search."
                            : "New funded deliveries will appear here. You can create a sample delivery in the merchant workspace."
                        }
                      />
                    </div>
                  )}
                  <section className="card courier-active">
                    <div className="section-header">
                      <h2>Your active deliveries</h2>
                      <span className="badge badge-muted">
                        Demo courier view
                      </span>
                    </div>
                    <DeliveryTable jobs={active} onSelect={setSelected} />
                  </section>
                </>
              ) : (
                <>
                  <div className="info-banner">
                    <ShieldCheck size={20} />
                    <p>
                      <strong>Unique-human verified.</strong> World ID proves
                      uniqueness and session control. It does not establish
                      legal identity, background checks, or parcel condition.
                    </p>
                  </div>
                  <div className="courier-grid">
                    {[
                      {
                        name: "Jamie Chen",
                        initials: "JC",
                        area: "Mission & Hayes Valley",
                        vehicle: "Bicycle",
                        deliveries: 142,
                      },
                      {
                        name: "Sam Rivera",
                        initials: "SR",
                        area: "Pacific Heights & Marina",
                        vehicle: "E-bike",
                        deliveries: 98,
                      },
                      {
                        name: "Taylor Kim",
                        initials: "TK",
                        area: "Castro & Noe Valley",
                        vehicle: "Bicycle",
                        deliveries: 116,
                      },
                      {
                        name: "Alex Morgan",
                        initials: "AM",
                        area: "SoMa & Nob Hill",
                        vehicle: "E-bike",
                        deliveries: 84,
                      },
                    ].map((c) => (
                      <div className="card courier-card" key={c.name}>
                        <div className="courier-card-top">
                          <Avatar initials={c.initials} />
                          <span className="badge badge-green">
                            <span className="status-dot" />
                            Demo profile
                          </span>
                        </div>
                        <h3>{c.name}</h3>
                        <p>
                          <MapPin size={14} />
                          {c.area}
                        </p>
                        <span className="courier-verification">
                          <ShieldCheck size={15} />
                          Unique-human verified · demo
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
            </>
          )}

          {recipientMode && (
            <section className="card">
              <div className="section-header">
                <h2>Your incoming parcels</h2>
                <span className="badge badge-muted">Recipient demo</span>
              </div>
              <div className="info-banner inset-info">
                <Package size={19} />
                <p>
                  In a live delivery, you receive a private, expiring
                  confirmation link. Here, choose a sample parcel to try the
                  handoff.
                </p>
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
                  note="Automatic payouts are frozen"
                  tone="cream"
                />
                <Stat
                  icon={Clock3}
                  title="Payout retries"
                  value={String(
                    state.jobs.filter((j) => j.status === "PAYOUT_RETRY")
                      .length,
                  )}
                  note="Recipient confirmation retained"
                  tone="blue"
                />
                <Stat
                  icon={CheckCheck}
                  title="Confirmed deliveries"
                  value={String(
                    state.jobs.filter((j) => j.status === "DELIVERY_CONFIRMED")
                      .length,
                  )}
                  note="Ready for demo settlement"
                  tone="green"
                />
              </div>
              <section className="card">
                <div className="section-header">
                  <h2>Exceptions & settlement</h2>
                  <span className="badge badge-muted">Operator demo</span>
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
              <div className="wallet-grid">
                <section className="balance-card">
                  <div className="balance-heading">
                    <span>
                      <Wallet size={19} />
                      {role === "Courier"
                        ? "Your courier earnings"
                        : "Your demo wallet"}
                    </span>
                    <span className="network-tag">
                      <span />
                      SUI · DEMO
                    </span>
                  </div>
                  <span className="balance-label">
                    {role === "Courier" ? "Total earned" : "Available balance"}
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
                      ? "Your completed deliveries, paid to you."
                      : "For the next good thing you send."}
                  </p>
                  {role === "Courier" ? (
                    <p className="courier-wallet-address">
                      <Wallet size={15} />
                      {DEMO_COURIER.payoutWallet}
                    </p>
                  ) : (
                    <button
                      className="button button-light"
                      onClick={() => setDialog("wallet")}
                    >
                      <Plus size={16} />
                      Funding details
                    </button>
                  )}
                  <div className="balance-decoration">
                    <Globe2 size={190} />
                  </div>
                </section>
                <section className="card wallet-summary">
                  <h2>Where your funds are</h2>
                  <div>
                    <span className="wallet-summary-icon">
                      <LockKeyhole size={20} />
                    </span>
                    <span>
                      <strong>Reserved in escrow</strong>
                      <small>Held for {active.length} active deliveries</small>
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
                    Demo balances only. No wallet or real funds connected.
                  </p>
                </section>
              </div>
              <section className="card">
                <div className="section-header">
                  <div>
                    <h2>Your payment history</h2>
                    <p>A clear record, from reserved to released.</p>
                  </div>
                  <span className="badge badge-muted">Demo USDC</span>
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
                          ? "Demo completed"
                          : j.status === "REFUNDED"
                            ? "Demo returned"
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
            </>
          )}

          {page === "Activity" && (
            <section className="card activity-card">
              <div className="section-header">
                <div>
                  <h2>The delivery journal</h2>
                  <p>Who confirmed what, and when. Always part of the story.</p>
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
          <footer className="page-footer">
            <span>
              <Brand small />
              Made for the last mile. And the people in it.
            </span>
            <span>
              <Leaf size={13} /> A little closer, together.
            </span>
          </footer>
        </main>
      </div>

      {selectedJob && (
        <DeliveryDetail
          key={selectedJob.id}
          job={selectedJob}
          initialRole={role}
          startWithAcceptance={startAcceptance}
          acceptanceReady={acceptanceReady}
          onClose={() => {
            setSelected(null);
            setStartAcceptance(false);
          }}
          onAction={updateJob}
          notify={notify}
        />
      )}
      {dialog === "create" && (
        <CreateDelivery
          available={Math.max(0, 250 - reserved - paidTotal)}
          onClose={() => setDialog(null)}
          onCreate={(job) => {
            save({ ...state, jobs: [job, ...state.jobs] });
            setDialog(null);
            setSelected(job.id);
            notify(
              "Delivery created with demo funds reserved. It’s ready for a courier.",
            );
          }}
        />
      )}
      {dialog === "guide" && (
        <Modal
          title="Good deliveries start with trust."
          subtitle="Welcome to the Haulie demo"
          onClose={() => setDialog(null)}
        >
          <div className="guide-intro">
            <Brand />
            <p>
              A verified human at every handoff.
              <br />
              Payment ready at delivery.
            </p>
          </div>
          <div className="guide-steps">
            {[
              {
                icon: LockKeyhole,
                title: "Fund it first",
                text: "A merchant creates a delivery and reserves the courier fee before it is offered.",
              },
              {
                icon: ShieldCheck,
                title: "A fresh check. Every time.",
                text: "The courier completes a new World ID session check to accept, then another at pickup.",
              },
              {
                icon: Package,
                title: "Hand it over, together",
                text: "The merchant confirms pickup. The recipient independently confirms delivery.",
              },
              {
                icon: Wallet,
                title: "Delivered. Then paid.",
                text: "Only the confirmed handoff permits settlement to the courier’s snapshotted wallet.",
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
              <strong>You’re in an interactive demo.</strong> Deliveries are
              saved in this browser. Checks and payments are simulated; no real
              World ID proof, wallet, or funds are used. Switch workspaces to
              explore all four roles.
            </p>
          </div>
          <p className="fine-print">
            World ID establishes unique humanity and session control, not legal
            identity, background screening, location, or parcel condition.
            Haulie’s live model is operator-attested delivery with on-chain
            escrow.
          </p>
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
          title="You’re in the loop."
          subtitle="Your notifications"
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
          <div className="notice">
            <Bell size={18} />
            <p>
              These notifications reflect your local demo deliveries. No
              external messages are sent.
            </p>
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
      {dialog === "wallet" && (
        <Modal
          title="A wallet with a clear purpose."
          subtitle="Demo funding details"
          onClose={() => setDialog(null)}
        >
          <div className="wallet-modal-icon">
            <Wallet size={36} />
          </div>
          <p className="modal-description">
            This workspace starts with 250 demo USDC. Creating a delivery
            reserves its fee; a confirmed handoff makes it available for a
            simulated courier payout.
          </p>
          <div className="notice">
            <LockKeyhole size={19} />
            <p>
              <strong>No real wallet is connected.</strong> Live funding
              requires a configured Sui testnet escrow and native testnet USDC.
              There is no deposit address in this demo.
            </p>
          </div>
          <button
            className="button button-primary full-width"
            onClick={() => {
              setDialog("create");
            }}
          >
            Create a demo delivery <Plus size={17} />
          </button>
        </Modal>
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
  note,
  trend,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  unit?: string;
  note: string;
  trend?: string;
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
        {trend && (
          <svg className="sparkline" viewBox="0 0 90 30" aria-hidden="true">
            <path
              d={
                tone === "green"
                  ? "M1 27 12 23 21 25 30 13 39 17 49 11 58 13 69 4 78 8 88 1"
                  : "M1 25 11 25 21 20 32 22 42 13 54 14 63 7 77 10 89 3"
              }
              fill="none"
              stroke={tone === "green" ? "#548563" : "#8daa72"}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
      <p>
        {trend && <span className="tiny-dot" />}
        {note}
      </p>
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
      title="A little breathing room."
      text="No deliveries match this view. Try another filter, or create a new delivery."
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
  const [draft, setDraft] = useState<Record<string, string>>({});
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
        { title: "Demo funds reserved", actor: "Merchant", at: now },
      ],
    });
  }
  return (
    <Modal
      title={
        step === 1 ? "Let’s get it there." : "One little check before it goes."
      }
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
                placeholder="450 Hayes St"
                required
                defaultValue={draft.pickupAddress}
              />
            </label>
            <label>
              Neighborhood
              <input
                name="pickupArea"
                placeholder="Hayes Valley"
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
                placeholder="890 Valencia St"
                required
                defaultValue={draft.destinationAddress}
              />
            </label>
            <label>
              Neighborhood
              <input
                name="destinationArea"
                placeholder="Mission District"
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
              Courier fee (demo USDC)
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
            {formatMoney(available)} demo USDC available. Small, legal,
            nonhazardous parcels only. Use sample addresses; details stay in
            this browser.
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
            <span>Courier fee, reserved upfront</span>
            <strong>
              {formatMoney(Number(fee))} <small>USDC</small>
            </strong>
          </div>
          <div className="notice">
            <LockKeyhole size={18} />
            <p>
              This fee is simulated. A courier must complete a fresh check
              before accepting. Unassigned deliveries can be cancelled for a
              full demo refund.
            </p>
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
              Reserve demo funds & create <ArrowRight size={16} />
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
    <Modal
      title="Make yourself at home."
      subtitle="Workspace settings"
      onClose={onClose}
    >
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
            <small>Demo workspace preference. No emails are sent.</small>
          </span>
        </label>
        <div className="settings-network">
          <span>
            <Globe2 size={18} />
            Environment
          </span>
          <strong>Interactive demo</strong>
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
            notify("Demo workspace reset. A fresh start.");
            onClose();
          }}
        >
          {resetConfirm ? "Confirm reset" : "Reset demo"}
        </button>
      </div>
    </Modal>
  );
}
