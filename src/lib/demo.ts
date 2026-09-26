import { migrateSeededRoute, SEEDED_DELIVERY_ROUTES } from "./tokyo-locations";

export type JobStatus =
  | "FUNDED"
  | "ASSIGNED"
  | "PICKED_UP"
  | "DELIVERY_CONFIRMED"
  | "PAID"
  | "DISPUTED"
  | "REFUNDED"
  | "PAYOUT_RETRY";
export type DemoRole = "Merchant" | "Courier" | "Recipient" | "Operator";
export const DEMO_COURIER = {
  name: "Jamie Chen",
  initials: "JC",
  payoutWallet: "jamie.sui (test)",
} as const;
export type DemoEvent = { title: string; actor: string; at: string };
export type DemoJob = {
  id: string;
  title: string;
  category: string;
  pickup: string;
  destination: string;
  pickupAddress: string;
  destinationAddress: string;
  recipient: string;
  fee: number;
  status: JobStatus;
  courier?: string;
  initials?: string;
  window: string;
  pickupVerified?: boolean;
  acceptVerified?: boolean;
  recipientConfirmed?: boolean;
  payoutWallet?: string;
  worldAcceptedAt?: number;
  worldPickedUpAt?: number;
  events: DemoEvent[];
  createdAt: string;
  disputeReason?: string;
  beforeDispute?: JobStatus;
};
export type DemoState = {
  jobs: DemoJob[];
  businessName: string;
  contact: string;
  notifications: boolean;
  courierEnrolled: boolean;
  walletConnected: boolean;
};
export function isWorldTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 8_640_000_000_000
  );
}
export function isSuiWalletAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}
export function isOwnCourierJob(job: DemoJob) {
  // Local board ownership only. This never authorizes a payment or a live job.
  return (
    job.courier === DEMO_COURIER.name &&
    (job.payoutWallet === DEMO_COURIER.payoutWallet ||
      (isSuiWalletAddress(job.payoutWallet) &&
        isWorldTimestamp(job.worldAcceptedAt)))
  );
}
export const STATUS: Record<JobStatus, { label: string; tone: string }> = {
  FUNDED: { label: "Finding a courier", tone: "amber" },
  ASSIGNED: { label: "Ready for pickup", tone: "blue" },
  PICKED_UP: { label: "On the way", tone: "green" },
  DELIVERY_CONFIRMED: { label: "Payout processing", tone: "blue" },
  PAID: { label: "Delivered", tone: "muted" },
  DISPUTED: { label: "Needs attention", tone: "red" },
  REFUNDED: { label: "Refunded", tone: "muted" },
  PAYOUT_RETRY: { label: "Payout retry", tone: "amber" },
};
const createdAt = "2026-09-26T09:00:00.000Z";
const ev = (title: string, actor: string): DemoEvent => ({
  title,
  actor,
  at: createdAt,
});
const job = (
  overrides: Partial<DemoJob> & Pick<DemoJob, "id" | "title" | "status">,
): DemoJob => ({
  category: "Small parcel",
  ...SEEDED_DELIVERY_ROUTES[overrides.id],
  recipient: "Jamie Lee",
  fee: 6,
  window: "Within 1 hour",
  createdAt,
  events: [
    ev("Delivery created", "Merchant"),
    ev("Test funds reserved", "Merchant"),
  ],
  ...overrides,
});
export const INITIAL_STATE: DemoState = {
  businessName: "The Everyday Store",
  contact: "alex@example.com",
  notifications: true,
  courierEnrolled: true,
  walletConnected: true,
  jobs: [
    job({
      id: "HL-1048",
      title: "A little everyday goodness",
      status: "PICKED_UP",
      courier: "Jamie Chen",
      initials: "JC",
      acceptVerified: true,
      pickupVerified: true,
      payoutWallet: "jamie.sui (test)",
      events: [
        ev("Test funds reserved", "Merchant"),
        ev("Fresh acceptance check completed", "Courier"),
        ev("Fresh pickup check completed", "Courier"),
        ev("Parcel handed over", "Merchant"),
      ],
    }),
    job({
      id: "HL-1047",
      title: "Fresh blooms for Olivia",
      category: "Flowers & plants",
      recipient: "Olivia Park",
      status: "ASSIGNED",
      fee: 8.5,
      courier: "Sam Rivera",
      initials: "SR",
      acceptVerified: true,
      payoutWallet: "sam.sui (test)",
      events: [
        ev("Test funds reserved", "Merchant"),
        ev("Fresh acceptance check completed", "Courier"),
      ],
    }),
    job({
      id: "HL-1046",
      title: "The weekend reading list",
      category: "Books & stationery",
      status: "FUNDED",
      fee: 5.5,
    }),
    job({
      id: "HL-1045",
      title: "Something sweet for Maya",
      category: "Packaged food",
      status: "PICKED_UP",
      courier: "Taylor Kim",
      initials: "TK",
      fee: 7,
      acceptVerified: true,
      pickupVerified: true,
      payoutWallet: "taylor.sui (test)",
      events: [
        ev("Test funds reserved", "Merchant"),
        ev("Fresh acceptance check completed", "Courier"),
        ev("Fresh pickup check completed", "Courier"),
        ev("Parcel handed over", "Merchant"),
      ],
    }),
    job({
      id: "HL-1044",
      title: "The essentials, delivered",
      status: "PAID",
      courier: "Jamie Chen",
      initials: "JC",
      fee: 6.5,
      acceptVerified: true,
      pickupVerified: true,
      recipientConfirmed: true,
      payoutWallet: "jamie.sui (test)",
      events: [
        ev("Test funds reserved", "Merchant"),
        ev("Fresh acceptance check completed", "Courier"),
        ev("Fresh pickup check completed", "Courier"),
        ev("Parcel handed over", "Merchant"),
        ev("Receipt confirmed", "Recipient"),
        ev("Simulated payout · no on-chain transfer", "Operator"),
      ],
    }),
    job({
      id: "HL-1043",
      title: "A thoughtful thank-you",
      category: "Gifts",
      status: "PAID",
      courier: "Alex Morgan",
      initials: "AM",
      fee: 6,
      acceptVerified: true,
      pickupVerified: true,
      recipientConfirmed: true,
      payoutWallet: "alex.sui (test)",
      events: [
        ev("Test funds reserved", "Merchant"),
        ev("Receipt confirmed", "Recipient"),
        ev("Simulated payout · no on-chain transfer", "Operator"),
      ],
    }),
  ],
};
export const INITIAL_SNAPSHOT = JSON.stringify(INITIAL_STATE);
export const STORAGE_KEY = "haulie-demo-v1";
export type DemoAction =
  | "ACCEPT"
  | "VERIFY_PICKUP"
  | "HANDOFF"
  | "CONFIRM_RECEIPT"
  | "PAY"
  | "FAIL_PAYOUT"
  | "DISPUTE"
  | "RESOLVE"
  | "UNASSIGN"
  | "REFUND"
  | "ATTEMPT";
export function transitionJob(
  current: DemoJob,
  action: DemoAction,
  reason?: string,
): DemoJob {
  const next = structuredClone(current);
  const require = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
  };
  const event = (title: string, actor: string) =>
    next.events.push({ title, actor, at: new Date().toISOString() });
  if (["VERIFY_PICKUP", "UNASSIGN", "ATTEMPT"].includes(action)) {
    require(isOwnCourierJob(
      next,
    ), "Only the assigned courier can take this action.");
  }
  switch (action) {
    case "ACCEPT":
      require(next.status ===
        "FUNDED", "Only a funded, unassigned delivery can be accepted.");
      next.status = "ASSIGNED";
      next.courier = DEMO_COURIER.name;
      next.initials = DEMO_COURIER.initials;
      next.acceptVerified = true;
      next.payoutWallet = DEMO_COURIER.payoutWallet;
      event("Fresh test acceptance check completed", "Courier");
      break;
    case "VERIFY_PICKUP":
      require(next.status === "ASSIGNED" &&
        next.acceptVerified &&
        !next.pickupVerified, "This pickup check has already been used or the delivery is not assigned.");
      next.pickupVerified = true;
      event("Fresh test pickup check completed", "Courier");
      break;
    case "HANDOFF":
      require(next.status === "ASSIGNED" &&
        next.pickupVerified &&
        next.acceptVerified, "A fresh pickup check is required before handing over the parcel.");
      next.status = "PICKED_UP";
      event("Parcel handed over", "Merchant");
      break;
    case "CONFIRM_RECEIPT":
      require(next.status === "PICKED_UP" &&
        next.pickupVerified &&
        next.acceptVerified, "Both courier checks and the merchant handoff are required.");
      next.status = "DELIVERY_CONFIRMED";
      next.recipientConfirmed = true;
      event("Receipt confirmed", "Recipient");
      break;
    case "PAY":
      require(["DELIVERY_CONFIRMED", "PAYOUT_RETRY"].includes(next.status) &&
        next.recipientConfirmed &&
        next.pickupVerified &&
        next.acceptVerified &&
        next.payoutWallet, "Payment is locked until all handoffs are confirmed and there is no dispute.");
      next.status = "PAID";
      event("Simulated payout · no on-chain transfer", "Operator");
      break;
    case "FAIL_PAYOUT":
      require(next.status ===
        "DELIVERY_CONFIRMED", "Only a pending payout can be retried.");
      next.status = "PAYOUT_RETRY";
      event("Simulated settlement failed · funds remain reserved", "Operator");
      break;
    case "DISPUTE":
      require([
        "ASSIGNED",
        "PICKED_UP",
        "DELIVERY_CONFIRMED",
        "PAYOUT_RETRY",
      ].includes(
        next.status,
      ), "A case can only be opened for an assigned, unsettled delivery.");
      require(reason?.trim(), "Please describe the issue.");
      next.beforeDispute = next.status;
      next.status = "DISPUTED";
      next.disputeReason = reason;
      event("Issue reported · payout frozen", "Merchant / Recipient");
      break;
    case "RESOLVE":
      require(next.status === "DISPUTED" &&
        next.beforeDispute, "There is no open case to resolve.");
      next.status = next.beforeDispute!;
      next.beforeDispute = undefined;
      event("Case resolved · delivery resumed", "Operator");
      break;
    case "UNASSIGN":
      require(next.status ===
        "ASSIGNED", "The courier can only cancel before pickup.");
      next.status = "FUNDED";
      next.courier = undefined;
      next.initials = undefined;
      next.acceptVerified = false;
      next.pickupVerified = false;
      next.payoutWallet = undefined;
      // Keep the acceptance timestamp so a status refresh cannot replay it.
      next.worldPickedUpAt = undefined;
      event("Assignment cancelled · funds remain reserved", "Courier");
      break;
    case "REFUND":
      require(next.status ===
        "FUNDED", "Only an unassigned delivery can be refunded.");
      next.status = "REFUNDED";
      event("Delivery cancelled · test funds returned", "Merchant");
      break;
    case "ATTEMPT":
      require(next.status ===
        "PICKED_UP", "Attempted delivery is only available after pickup.");
      event(
        "Delivery attempted · recipient unavailable, payout held",
        "Courier",
      );
      break;
  }
  return next;
}
export function readSnapshot() {
  try {
    return localStorage.getItem(STORAGE_KEY) || INITIAL_SNAPSHOT;
  } catch {
    return INITIAL_SNAPSHOT;
  }
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isNonemptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const isDateString = (value: unknown) =>
  isNonemptyString(value) && Number.isFinite(Date.parse(value));
const isStatus = (value: unknown): value is JobStatus =>
  typeof value === "string" && Object.hasOwn(STATUS, value);

function isDemoJob(value: unknown): value is DemoJob {
  if (!isRecord(value)) return false;
  const requiredText = [
    "id",
    "title",
    "category",
    "pickup",
    "destination",
    "pickupAddress",
    "destinationAddress",
    "recipient",
    "window",
  ];
  if (!requiredText.every((key) => isNonemptyString(value[key]))) return false;
  if (!isStatus(value.status) || !isDateString(value.createdAt)) return false;
  if (
    typeof value.fee !== "number" ||
    !Number.isFinite(value.fee) ||
    value.fee < 1 ||
    value.fee > 50
  )
    return false;
  if (
    !["acceptVerified", "pickupVerified", "recipientConfirmed"].every(
      (key) => value[key] === undefined || typeof value[key] === "boolean",
    )
  )
    return false;
  if (
    !["worldAcceptedAt", "worldPickedUpAt"].every(
      (key) => value[key] === undefined || isWorldTimestamp(value[key]),
    ) ||
    (value.worldPickedUpAt !== undefined &&
      (!isWorldTimestamp(value.worldAcceptedAt) ||
        (value.worldPickedUpAt as number) < value.worldAcceptedAt))
  )
    return false;
  if (
    !["courier", "initials", "payoutWallet", "disputeReason"].every(
      (key) => value[key] === undefined || isNonemptyString(value[key]),
    )
  )
    return false;
  if (value.courier !== undefined && !isNonemptyString(value.initials))
    return false;
  if (value.beforeDispute !== undefined && !isStatus(value.beforeDispute))
    return false;
  if (
    value.status === "DISPUTED" &&
    (!isNonemptyString(value.disputeReason) ||
      !["ASSIGNED", "PICKED_UP", "DELIVERY_CONFIRMED", "PAYOUT_RETRY"].includes(
        String(value.beforeDispute),
      ))
  )
    return false;
  return (
    Array.isArray(value.events) &&
    value.events.every(
      (event) =>
        isRecord(event) &&
        isNonemptyString(event.title) &&
        isNonemptyString(event.actor) &&
        isDateString(event.at),
    )
  );
}

export function parseSnapshot(snapshot: string): DemoState {
  try {
    const state: unknown = JSON.parse(snapshot);
    if (
      isRecord(state) &&
      Array.isArray(state.jobs) &&
      state.jobs.every(isDemoJob) &&
      new Set(state.jobs.map((job) => job.id)).size === state.jobs.length &&
      isNonemptyString(state.businessName) &&
      isNonemptyString(state.contact) &&
      typeof state.notifications === "boolean" &&
      typeof state.courierEnrolled === "boolean" &&
      typeof state.walletConnected === "boolean"
    ) {
      const parsed = state as DemoState;
      const neutralText = (text: string) =>
        text
          .replace(/Demo payout completed/g, "Simulated payout")
          .replace(/Demo settlement failed/g, "Simulated settlement failed")
          .replace(/\bDemo\b/g, "Test")
          .replace(/\bdemo\b/g, "test");
      // Preserve saved assignments while updating the old fixture wording.
      return {
        ...parsed,
        jobs: parsed.jobs.map((job) => ({
          ...migrateSeededRoute(job),
          ...(job.payoutWallet
            ? { payoutWallet: job.payoutWallet.replace(/\(demo\)/gi, "(test)") }
            : {}),
          events: job.events.map((event) => ({
            ...event,
            title: neutralText(event.title),
            actor: neutralText(event.actor),
          })),
        })),
      };
    }
  } catch {
    /* Invalid local demo data resets to an independent copy of the fixture. */
  }
  return structuredClone(INITIAL_STATE);
}
export function subscribeDemo(callback: () => void) {
  window.addEventListener("haulie:change", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("haulie:change", callback);
    window.removeEventListener("storage", callback);
  };
}
export function persistDemo(state: DemoState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event("haulie:change"));
}
export function formatMoney(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
