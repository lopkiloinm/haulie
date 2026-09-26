import {
  DEMO_COURIER,
  INITIAL_STATE,
  isOwnCourierJob,
  isSuiWalletAddress,
  isWorldTimestamp,
  type DemoJob,
  type DemoState,
} from "./demo";

export type WorldJobRecord = {
  accepted: number;
  pickedUp?: number;
  payoutWallet?: string;
};

const supportedJobs = new Set(INITIAL_STATE.jobs.map((job) => job.id));

function validRecord(record: WorldJobRecord | undefined): record is WorldJobRecord {
  return (
    !!record &&
    isWorldTimestamp(record.accepted) &&
    isSuiWalletAddress(record.payoutWallet) &&
    (record.pickedUp === undefined ||
      (isWorldTimestamp(record.pickedUp) && record.pickedUp >= record.accepted))
  );
}

function worldEvent(title: string, time: number) {
  return { title, actor: "Courier", at: new Date(time * 1000).toISOString() };
}

/**
 * Display projection of server-verified, browser-scoped World records onto the
 * local delivery board. This state is editable by the browser and must never
 * authorize live assignments, attest wallet ownership, or release Sui payments.
 */
export function reconcileWorldJobs(
  state: DemoState,
  records: Record<string, WorldJobRecord>,
): DemoState {
  let changed = false;
  const jobs = state.jobs.map((job): DemoJob => {
    if (!supportedJobs.has(job.id) || !Object.hasOwn(records, job.id)) return job;
    const record = records[job.id];
    if (!validRecord(record)) return job;

    let next = job;
    if (
      job.status === "FUNDED" &&
      !job.courier &&
      (job.worldAcceptedAt === undefined || record.accepted > job.worldAcceptedAt)
    ) {
      next = {
        ...job,
        status: "ASSIGNED",
        courier: DEMO_COURIER.name,
        initials: DEMO_COURIER.initials,
        acceptVerified: true,
        pickupVerified: false,
        recipientConfirmed: false,
        payoutWallet: record.payoutWallet,
        worldAcceptedAt: record.accepted,
        worldPickedUpAt: undefined,
        events: [
          ...job.events,
          worldEvent("World acceptance verified", record.accepted),
        ],
      };
    }

    if (
      next.status === "ASSIGNED" &&
      isOwnCourierJob(next) &&
      next.acceptVerified &&
      next.worldAcceptedAt === record.accepted &&
      next.payoutWallet === record.payoutWallet &&
      record.pickedUp !== undefined &&
      next.worldPickedUpAt === undefined &&
      !next.pickupVerified
    ) {
      next = {
        ...next,
        pickupVerified: true,
        worldPickedUpAt: record.pickedUp,
        events: [
          ...next.events,
          worldEvent("World pickup verified", record.pickedUp),
        ],
      };
    }

    if (next !== job) changed = true;
    return next;
  });
  return changed ? { ...state, jobs } : state;
}
