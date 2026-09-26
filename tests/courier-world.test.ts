import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEMO_COURIER,
  INITIAL_STATE,
  isOwnCourierJob,
  parseSnapshot,
  transitionJob,
  type DemoState,
} from "../src/lib/demo";
import {
  reconcileWorldJobs,
  type WorldJobRecord,
} from "../src/lib/courier-world";

const jobId = "HL-1046";
const wallet = `0x${"a".repeat(64)}`;
const otherWallet = `0x${"b".repeat(64)}`;
const accepted = 1_790_409_600;
const record: WorldJobRecord = { accepted, payoutWallet: wallet };
const state = () => structuredClone(INITIAL_STATE);
const findJob = (value: DemoState) => value.jobs.find((job) => job.id === jobId)!;

describe("World verification projection onto the local courier board", () => {
  it("projects verified acceptance with its wallet snapshot and leaves prior state untouched", () => {
    const before = state();
    const original = structuredClone(before);
    const after = reconcileWorldJobs(before, { [jobId]: record });
    const assigned = findJob(after);
    assert.equal(assigned.status, "ASSIGNED");
    assert.equal(assigned.courier, DEMO_COURIER.name);
    assert.equal(assigned.initials, DEMO_COURIER.initials);
    assert.equal(assigned.acceptVerified, true);
    assert.equal(assigned.pickupVerified, false);
    assert.equal(assigned.payoutWallet, wallet);
    assert.equal(assigned.worldAcceptedAt, accepted);
    assert.equal(assigned.events.at(-1)?.title, "World acceptance verified");
    assert.equal(isOwnCourierJob(assigned), true);
    assert.deepEqual(before, original);
    assert.equal(after.jobs[0], before.jobs[0], "unaffected rows keep their identity");
    assert.equal(reconcileWorldJobs(after, { [jobId]: record }), after);
  });

  it("projects a fresh matching pickup once and still requires merchant handoff and receipt", () => {
    const assigned = reconcileWorldJobs(state(), { [jobId]: record });
    const pickupRecord = { ...record, pickedUp: accepted + 120 };
    const verified = reconcileWorldJobs(assigned, { [jobId]: pickupRecord });
    const job = findJob(verified);
    assert.equal(job.status, "ASSIGNED", "verification is not parcel custody");
    assert.equal(job.pickupVerified, true);
    assert.equal(job.worldPickedUpAt, accepted + 120);
    assert.equal(job.events.length, findJob(assigned).events.length + 1);
    assert.equal(reconcileWorldJobs(verified, { [jobId]: pickupRecord }), verified);
    assert.throws(() => transitionJob(job, "CONFIRM_RECEIPT"));
    assert.throws(() => transitionJob(job, "PAY"));
    const collected = transitionJob(job, "HANDOFF");
    assert.equal(collected.status, "PICKED_UP");
    assert.throws(() => transitionJob(collected, "PAY"));
    assert.equal(
      findJob(reconcileWorldJobs(state(), { [jobId]: pickupRecord })).worldPickedUpAt,
      accepted + 120,
      "a status refresh can restore both completed checks together",
    );
  });

  it("never replaces another courier, a completed delivery, or an unknown job", () => {
    const before = state();
    const records = Object.fromEntries(before.jobs.map((job) => [job.id, record]));
    const after = reconcileWorldJobs(before, records);
    for (const job of before.jobs.filter((job) => job.id !== jobId))
      assert.equal(after.jobs.find((current) => current.id === job.id), job);

    const conflicted = state();
    findJob(conflicted).courier = "Another courier";
    assert.equal(reconcileWorldJobs(conflicted, { [jobId]: record }), conflicted);
    const unknown = state();
    findJob(unknown).id = "HL-9999";
    assert.equal(reconcileWorldJobs(unknown, { "HL-9999": record }), unknown);
  });

  it("ignores missing, malformed, and out-of-sequence verification records", () => {
    const before = state();
    assert.equal(reconcileWorldJobs(before, {}), before);
    const invalid = [
      { accepted },
      { ...record, payoutWallet: "jamie.sui (test)" },
      { ...record, payoutWallet: "0xa" },
      { ...record, payoutWallet: `0x${"z".repeat(64)}` },
      { ...record, accepted: 0 },
      { ...record, accepted: -1 },
      { ...record, accepted: 1.5 },
      { ...record, accepted: Infinity },
      { ...record, accepted: Number.MAX_SAFE_INTEGER },
      { ...record, pickedUp: accepted - 1 },
      { payoutWallet: wallet, pickedUp: accepted + 1 },
    ];
    for (const value of invalid)
      assert.equal(
        reconcileWorldJobs(before, { [jobId]: value as WorldJobRecord }),
        before,
      );
  });

  it("does not apply pickup from a different acceptance or wallet", () => {
    const assigned = reconcileWorldJobs(state(), { [jobId]: record });
    for (const value of [
      { ...record, accepted: accepted + 1, pickedUp: accepted + 100 },
      { ...record, payoutWallet: otherWallet, pickedUp: accepted + 100 },
    ])
      assert.equal(reconcileWorldJobs(assigned, { [jobId]: value }), assigned);

    const localOnly = state();
    const index = localOnly.jobs.findIndex((job) => job.id === jobId);
    localOnly.jobs[index] = transitionJob(localOnly.jobs[index], "ACCEPT");
    assert.equal(
      reconcileWorldJobs(localOnly, { [jobId]: { ...record, pickedUp: accepted + 100 } }),
      localOnly,
      "an unrelated locally assigned fixture cannot inherit World pickup",
    );
  });

  it("preserves the cancelled acceptance timestamp so refresh cannot replay assignment or pickup", () => {
    const verified = reconcileWorldJobs(state(), {
      [jobId]: { ...record, pickedUp: accepted + 100 },
    });
    const cancelled = {
      ...verified,
      jobs: verified.jobs.map((job) =>
        job.id === jobId ? transitionJob(job, "UNASSIGN") : job,
      ),
    };
    const job = findJob(cancelled);
    assert.equal(job.status, "FUNDED");
    assert.equal(job.worldAcceptedAt, accepted);
    assert.equal(job.worldPickedUpAt, undefined);
    assert.equal(job.courier, undefined);
    assert.equal(job.payoutWallet, undefined);
    assert.equal(job.acceptVerified, false);
    assert.equal(job.pickupVerified, false);
    for (const value of [
      record,
      { ...record, pickedUp: accepted + 100 },
      { ...record, accepted: accepted - 1 },
    ])
      assert.equal(reconcileWorldJobs(cancelled, { [jobId]: value }), cancelled);
    const restored = parseSnapshot(JSON.stringify(cancelled));
    assert.equal(reconcileWorldJobs(restored, { [jobId]: record }), restored);
    const newer = reconcileWorldJobs(cancelled, {
      [jobId]: { accepted: accepted + 200, payoutWallet: otherWallet },
    });
    assert.equal(findJob(newer).worldAcceptedAt, accepted + 200);
    assert.equal(findJob(newer).payoutWallet, otherWallet);
    assert.equal(findJob(newer).pickupVerified, false);
  });

  it("limits display ownership to the courier and a recognized wallet snapshot", () => {
    const assigned = findJob(reconcileWorldJobs(state(), { [jobId]: record }));
    assert.equal(isOwnCourierJob({ ...assigned, courier: "Sam Rivera" }), false);
    assert.equal(isOwnCourierJob({ ...assigned, worldAcceptedAt: undefined }), false);
    assert.equal(isOwnCourierJob({ ...assigned, payoutWallet: "invalid" }), false);
    assert.equal(isOwnCourierJob(transitionJob(findJob(state()), "ACCEPT")), true);
  });
});

describe("saved courier state compatibility", () => {
  it("migrates legacy fixture wallets and event wording without losing courier ownership", () => {
    const original = state();
    const assigned = transitionJob(findJob(original), "ACCEPT");
    assigned.payoutWallet = "jamie.sui (demo)";
    assigned.events = [
      { title: "Demo funds reserved", actor: "Merchant", at: assigned.createdAt },
      { title: "Fresh demo acceptance check completed", actor: "Courier", at: assigned.createdAt },
      { title: "Demo payout completed · no on-chain transfer", actor: "Demo operator", at: assigned.createdAt },
    ];
    original.jobs = [assigned];
    const parsed = parseSnapshot(JSON.stringify(original));
    const migrated = findJob(parsed);
    assert.equal(migrated.payoutWallet, DEMO_COURIER.payoutWallet);
    assert.equal(isOwnCourierJob(migrated), true);
    assert.equal(migrated.events[0].title, "Test funds reserved");
    assert.equal(migrated.events[1].title, "Fresh test acceptance check completed");
    assert.equal(migrated.events[2].title, "Simulated payout · no on-chain transfer");
    assert.equal(migrated.events[2].actor, "Test operator");
    assert.equal(transitionJob(migrated, "VERIFY_PICKUP").pickupVerified, true);
  });

  it("validates new timestamps and their order when loading saved state", () => {
    const verified = reconcileWorldJobs(state(), {
      [jobId]: { ...record, pickedUp: accepted + 100 },
    });
    assert.deepEqual(parseSnapshot(JSON.stringify(verified)), verified);
    for (const patch of [
      { worldAcceptedAt: null },
      { worldAcceptedAt: "yesterday" },
      { worldAcceptedAt: -1 },
      { worldAcceptedAt: 1.5 },
      { worldAcceptedAt: Number.MAX_SAFE_INTEGER },
      { worldAcceptedAt: undefined, worldPickedUpAt: accepted },
      { worldPickedUpAt: "today" },
      { worldPickedUpAt: accepted - 1 },
    ]) {
      const invalid = { ...verified, jobs: [{ ...findJob(verified), ...patch }] };
      assert.deepEqual(parseSnapshot(JSON.stringify(invalid)), INITIAL_STATE);
    }
  });
});
