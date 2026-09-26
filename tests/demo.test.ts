import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INITIAL_SNAPSHOT, INITIAL_STATE, parseSnapshot, transitionJob, type DemoAction, type DemoJob } from "../src/lib/demo";

function fundedJob(): DemoJob {
  return structuredClone(INITIAL_STATE.jobs.find((job) => job.status === "FUNDED")!);
}

function advance(...actions: DemoAction[]): DemoJob {
  return actions.reduce((job, action) => transitionJob(job, action), fundedJob());
}

const throughPickup: DemoAction[] = ["ACCEPT", "VERIFY_PICKUP", "HANDOFF"];
const throughReceipt: DemoAction[] = [...throughPickup, "CONFIRM_RECEIPT"];

describe("demo delivery authorization and custody", () => {
  it("requires separate acceptance, pickup, merchant handoff, receipt, and payout actions", () => {
    const original = fundedJob();
    const assigned = transitionJob(original, "ACCEPT");
    assert.equal(assigned.status, "ASSIGNED");
    assert.equal(assigned.acceptVerified, true);
    assert.equal(assigned.pickupVerified, undefined);
    assert.equal(assigned.courier, "Jamie Chen");
    assert.equal(assigned.payoutWallet, "jamie.sui (demo)");

    const verified = transitionJob(assigned, "VERIFY_PICKUP");
    assert.equal(verified.status, "ASSIGNED", "a pickup check does not transfer custody");
    assert.equal(verified.pickupVerified, true);

    const collected = transitionJob(verified, "HANDOFF");
    assert.equal(collected.status, "PICKED_UP");
    assert.equal(collected.events.at(-1)?.actor, "Merchant");

    const received = transitionJob(collected, "CONFIRM_RECEIPT");
    assert.equal(received.status, "DELIVERY_CONFIRMED", "receipt must not claim that payout succeeded");
    assert.equal(received.recipientConfirmed, true);
    assert.equal(received.events.at(-1)?.actor, "Recipient");

    const paid = transitionJob(received, "PAY");
    assert.equal(paid.status, "PAID");
    assert.equal(paid.payoutWallet, assigned.payoutWallet, "payout keeps the acceptance wallet snapshot");
    assert.equal(paid.events.at(-1)?.title, "Demo payout completed · no on-chain transfer");
    assert.equal(paid.events.length, original.events.length + 5);
    assert.deepEqual(original, fundedJob(), "transitions must leave prior state untouched");
  });

  it("blocks acceptance or pickup checks in the wrong stage and rejects repeated checks", () => {
    assert.throws(() => transitionJob(fundedJob(), "VERIFY_PICKUP"));
    const assigned = advance("ACCEPT");
    assert.throws(() => transitionJob(assigned, "ACCEPT"));
    const verified = transitionJob(assigned, "VERIFY_PICKUP");
    const snapshot = structuredClone(verified);
    assert.throws(() => transitionJob(verified, "VERIFY_PICKUP"), /already been used/);
    assert.deepEqual(verified, snapshot, "a rejected replay must not append an event or mutate state");
    assert.throws(() => transitionJob(advance(...throughPickup), "VERIFY_PICKUP"));
  });

  it("does not let the merchant skip fresh pickup verification or reuse handoff", () => {
    assert.throws(() => transitionJob(fundedJob(), "HANDOFF"), /fresh pickup check/);
    assert.throws(() => transitionJob(advance("ACCEPT"), "HANDOFF"), /fresh pickup check/);
    const withoutAcceptance = { ...advance("ACCEPT", "VERIFY_PICKUP"), acceptVerified: false };
    assert.throws(() => transitionJob(withoutAcceptance, "HANDOFF"), /fresh pickup check/);
    assert.throws(() => transitionJob(advance(...throughPickup), "HANDOFF"));
  });

  it("requires both verification checks and actual pickup before receipt can be confirmed", () => {
    for (const actions of [[], ["ACCEPT"], ["ACCEPT", "VERIFY_PICKUP"]] as DemoAction[][]) {
      assert.throws(() => transitionJob(advance(...actions), "CONFIRM_RECEIPT"));
    }
    const collected = advance(...throughPickup);
    assert.throws(() => transitionJob({ ...collected, acceptVerified: false }, "CONFIRM_RECEIPT"));
    assert.throws(() => transitionJob({ ...collected, pickupVerified: false }, "CONFIRM_RECEIPT"));
    assert.throws(() => transitionJob(advance(...throughReceipt), "CONFIRM_RECEIPT"));
  });

  it("requires a recipient confirmation, both checks, and a snapshotted wallet for payout", () => {
    for (const actions of [[], ["ACCEPT"], throughPickup] as DemoAction[][]) {
      assert.throws(() => transitionJob(advance(...actions), "PAY"), /Payment is locked/);
    }
    const received = advance(...throughReceipt);
    for (const missing of [
      { recipientConfirmed: false },
      { acceptVerified: false },
      { pickupVerified: false },
      { payoutWallet: undefined },
    ]) {
      assert.throws(() => transitionJob({ ...received, ...missing }, "PAY"), /Payment is locked/);
    }
  });

  it("records an unavailable recipient without confirming receipt or releasing payment", () => {
    assert.throws(() => transitionJob(advance("ACCEPT"), "ATTEMPT"));
    const collected = advance(...throughPickup);
    const attempted = transitionJob(collected, "ATTEMPT");
    assert.equal(attempted.status, "PICKED_UP");
    assert.equal(attempted.recipientConfirmed, undefined);
    assert.equal(attempted.events.length, collected.events.length + 1);
    assert.match(attempted.events.at(-1)!.title, /recipient unavailable, payout held/);
    assert.throws(() => transitionJob(attempted, "PAY"));
  });
});

describe("demo disputes, cancellations, and settlement recovery", () => {
  it("freezes automatic progress and payout during a dispute, then resumes the original stage", () => {
    const actionsByStage: DemoAction[][] = [["ACCEPT"], throughPickup, throughReceipt, [...throughReceipt, "FAIL_PAYOUT"]];
    for (const actions of actionsByStage) {
      const current = advance(...actions);
      const frozen = transitionJob(current, "DISPUTE", "Parcel appears damaged");
      assert.equal(frozen.status, "DISPUTED");
      assert.equal(frozen.beforeDispute, current.status);
      assert.equal(frozen.disputeReason, "Parcel appears damaged");
      for (const blocked of ["ACCEPT", "VERIFY_PICKUP", "HANDOFF", "CONFIRM_RECEIPT", "PAY", "FAIL_PAYOUT", "UNASSIGN", "REFUND", "ATTEMPT"] as DemoAction[]) {
        assert.throws(() => transitionJob(frozen, blocked), `${blocked} must not advance a disputed delivery`);
      }
      const resolved = transitionJob(frozen, "RESOLVE");
      assert.equal(resolved.status, current.status);
      assert.equal(resolved.beforeDispute, undefined);
      assert.equal(resolved.payoutWallet, current.payoutWallet);
      assert.equal(resolved.events.at(-1)?.actor, "Operator");
      assert.throws(() => transitionJob(resolved, "RESOLVE"), /no open case/);
    }
  });

  it("requires a dispute reason and an unsettled assignment", () => {
    const assigned = advance("ACCEPT");
    assert.throws(() => transitionJob(assigned, "DISPUTE"), /describe the issue/);
    assert.throws(() => transitionJob(assigned, "DISPUTE", "   "), /describe the issue/);
    assert.throws(() => transitionJob(fundedJob(), "DISPUTE", "Missing parcel"));
    assert.throws(() => transitionJob(advance(...throughReceipt, "PAY"), "DISPUTE", "Missing parcel"));
    const frozen = transitionJob(assigned, "DISPUTE", "Unable to contact courier");
    assert.throws(() => transitionJob(frozen, "DISPUTE", "Duplicate case"));
    assert.throws(() => transitionJob(fundedJob(), "RESOLVE"));
  });

  it("resets assignment, both verification gates, and payout wallet before reoffering a job", () => {
    const assigned = advance("ACCEPT", "VERIFY_PICKUP");
    const cancelled = transitionJob(assigned, "UNASSIGN");
    assert.equal(cancelled.status, "FUNDED");
    assert.equal(cancelled.courier, undefined);
    assert.equal(cancelled.initials, undefined);
    assert.equal(cancelled.acceptVerified, false);
    assert.equal(cancelled.pickupVerified, false);
    assert.equal(cancelled.payoutWallet, undefined);
    assert.equal(cancelled.fee, assigned.fee, "cancelled assignment retains the funded fee");
    assert.throws(() => transitionJob(cancelled, "HANDOFF"));
    const reassigned = transitionJob(cancelled, "ACCEPT");
    assert.equal(reassigned.status, "ASSIGNED");
    assert.equal(reassigned.acceptVerified, true);
    assert.equal(reassigned.pickupVerified, false, "the previous courier's pickup check cannot be reused");
    assert.throws(() => transitionJob(reassigned, "HANDOFF"));
  });

  it("allows refund only after the delivery is unassigned and blocks future progress after refund", () => {
    assert.throws(() => transitionJob(advance("ACCEPT"), "REFUND"));
    const cancelled = transitionJob(advance("ACCEPT"), "UNASSIGN");
    const refunded = transitionJob(cancelled, "REFUND");
    assert.equal(refunded.status, "REFUNDED");
    assert.equal(refunded.payoutWallet, undefined);
    assert.equal(refunded.events.at(-1)?.actor, "Merchant");
    for (const action of ["ACCEPT", "VERIFY_PICKUP", "HANDOFF", "CONFIRM_RECEIPT", "PAY", "REFUND", "UNASSIGN"] as DemoAction[]) {
      assert.throws(() => transitionJob(refunded, action));
    }
    for (const actions of [throughPickup, throughReceipt, [...throughReceipt, "PAY"]] as DemoAction[][]) {
      assert.throws(() => transitionJob(advance(...actions), "UNASSIGN"), /before pickup/);
      assert.throws(() => transitionJob(advance(...actions), "REFUND"));
    }
  });

  it("retains confirmed custody after settlement failure and permits exactly one successful payout", () => {
    assert.throws(() => transitionJob(advance(...throughPickup), "FAIL_PAYOUT"));
    const received = advance(...throughReceipt);
    const retry = transitionJob(received, "FAIL_PAYOUT");
    assert.equal(retry.status, "PAYOUT_RETRY");
    assert.equal(retry.recipientConfirmed, true);
    assert.equal(retry.pickupVerified, true);
    assert.equal(retry.acceptVerified, true);
    assert.equal(retry.payoutWallet, received.payoutWallet);
    assert.match(retry.events.at(-1)!.title, /funds remain reserved/);
    assert.throws(() => transitionJob(retry, "CONFIRM_RECEIPT"));
    const paid = transitionJob(retry, "PAY");
    assert.equal(paid.status, "PAID");
    assert.equal(paid.events.filter((event) => event.title.startsWith("Demo payout completed")).length, 1);
    const snapshot = structuredClone(paid);
    assert.throws(() => transitionJob(paid, "PAY"), /Payment is locked/);
    assert.throws(() => transitionJob(paid, "FAIL_PAYOUT"));
    assert.deepEqual(paid, snapshot, "a repeated payout must not change the settled state");
  });
});

describe("stored demo state recovery", () => {
  it("loads valid demo state, including an empty workspace and normal delivery transitions", () => {
    assert.deepEqual(parseSnapshot(INITIAL_SNAPSHOT), INITIAL_STATE);
    const empty = { ...INITIAL_STATE, jobs: [] };
    assert.deepEqual(parseSnapshot(JSON.stringify(empty)), empty);
    const current = { ...INITIAL_STATE, businessName: "Changed store", jobs: [advance(...throughReceipt)] };
    assert.deepEqual(parseSnapshot(JSON.stringify(current)), current);
    const disputed = { ...current, jobs: [transitionJob(current.jobs[0], "DISPUTE", "Damaged parcel")] };
    assert.deepEqual(parseSnapshot(JSON.stringify(disputed)), disputed);
  });

  it("recovers from malformed shapes and invalid required workspace fields", () => {
    const invalid = [null, [], {}, { ...INITIAL_STATE, jobs: [null] },
      { ...INITIAL_STATE, businessName: "  " }, { ...INITIAL_STATE, contact: null },
      { ...INITIAL_STATE, notifications: "true" }, { ...INITIAL_STATE, courierEnrolled: undefined },
      { ...INITIAL_STATE, walletConnected: 1 }];
    for (const value of invalid) assert.deepEqual(parseSnapshot(JSON.stringify(value)), INITIAL_STATE);
    assert.deepEqual(parseSnapshot("not json"), INITIAL_STATE);
  });

  it("rejects inherited statuses, incomplete couriers, malformed event data, and duplicate delivery IDs", () => {
    const original = fundedJob();
    const patches = [
      { status: "toString" }, { status: "__proto__" }, { status: "UNKNOWN" },
      { courier: "Jamie Chen", initials: undefined }, { initials: 42 },
      { pickupAddress: undefined }, { recipient: null }, { title: " " },
      { acceptVerified: "true" }, { payoutWallet: {} },
      { createdAt: "invalid date" }, { events: [null] },
      { events: [{ title: "Something happened", actor: null, at: original.createdAt }] },
      { events: [{ title: "Something happened", actor: "Merchant", at: "not a date" }] },
      { status: "DISPUTED", disputeReason: "Damaged parcel", beforeDispute: "PAID" },
    ];
    for (const patch of patches) {
      assert.deepEqual(parseSnapshot(JSON.stringify({ ...INITIAL_STATE, jobs: [{ ...original, ...patch }] })), INITIAL_STATE);
    }
    assert.deepEqual(parseSnapshot(JSON.stringify({ ...INITIAL_STATE, jobs: [original, original] })), INITIAL_STATE);
  });

  it("rejects nonfinite or out-of-range fees while preserving both supported bounds", () => {
    for (const fee of [NaN, Infinity, -Infinity, -1, 0, 0.99, 50.01, "6"]) {
      assert.deepEqual(parseSnapshot(JSON.stringify({ ...INITIAL_STATE, jobs: [{ ...fundedJob(), fee }] })), INITIAL_STATE);
    }
    for (const fee of [1, 6.25, 50]) {
      const state = { ...INITIAL_STATE, businessName: "Fee bounds", jobs: [{ ...fundedJob(), fee }] };
      assert.deepEqual(parseSnapshot(JSON.stringify(state)), state);
    }
  });

  it("returns independent fallback objects so callers cannot modify the shared initial fixture", () => {
    const fallback = parseSnapshot("invalid");
    const second = parseSnapshot("invalid");
    assert.notEqual(fallback, INITIAL_STATE);
    assert.notEqual(fallback.jobs[0], INITIAL_STATE.jobs[0]);
    fallback.businessName = "Mutated";
    fallback.jobs[0].events.push({ title: "Changed", actor: "Merchant", at: new Date().toISOString() });
    assert.equal(INITIAL_STATE.businessName, "The Everyday Store");
    assert.deepEqual(second, JSON.parse(INITIAL_SNAPSHOT));
    assert.deepEqual(INITIAL_STATE, JSON.parse(INITIAL_SNAPSHOT));
  });
});
