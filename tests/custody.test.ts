import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildCustodyRecords,
  coinFromEscrowType,
  formatCoinAmount,
} from "../src/lib/sui/custody";

const pkg = `0x${"d".repeat(64)}`;
const escrow = `0x${"e".repeat(64)}`;
const merchant = `0x${"a".repeat(64)}`;
const courier = `0x${"c".repeat(64)}`;
const operator = `0x${"f".repeat(64)}`;
const ref = (jobId: string) =>
  createHash("sha256").update(`haulie:job:${jobId}`).digest("base64");

function event(kind: number, second: number, sender = operator, jobId = "HL-1044") {
  return {
    timestamp: `2026-09-26T13:37:${String(second).padStart(2, "0")}.000Z`,
    sender: { address: sender },
    transaction: { digest: `${kind}`.repeat(44) },
    contents: {
      json: {
        escrow_id: escrow,
        job_ref: ref(jobId),
        kind,
        amount: "6500000",
        recipient: kind === 0 ? merchant : courier,
      },
    },
  };
}

function object(state: number, coin = "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI") {
  return {
    asMoveObject: {
      contents: {
        type: { repr: `${pkg}::escrow::Escrow<${coin}>` },
        json: {
          merchant,
          amount: "6500000",
          funds: state >= 5 ? "0" : "6500000",
          payout: state === 0 ? `0x${"0".repeat(64)}` : courier,
          state,
        },
      },
    },
  };
}

describe("on-chain custody records", () => {
  it("links a hashed job reference to its sample order and orders its history", () => {
    const [record] = buildCustodyRecords(
      [event(5, 20), event(0, 1, merchant), event(2, 10), event(1, 5), event(3, 15)],
      { [escrow]: object(5) },
      pkg,
    );
    assert.equal(record.job?.id, "HL-1044");
    assert.deepEqual(record.events.map((e) => e.kind), [0, 1, 2, 3, 5]);
    assert.equal(record.parcelWith, "Recipient");
    assert.equal(record.funds, "Released to courier");
    assert.equal(record.payout, courier);
    assert.equal(formatCoinAmount(record.amount, record.coin), "0.0065 SUI");
  });

  it("keeps the holder that preceded a dispute and freezes the fee", () => {
    const [record] = buildCustodyRecords(
      [event(0, 1, merchant), event(1, 2), event(2, 3), event(4, 4, merchant)],
      { [escrow]: object(4) },
      pkg,
    );
    assert.equal(record.parcelWith, "Courier");
    assert.equal(record.funds, "Frozen in escrow");
  });

  it("shows an unassigned funded parcel with no courier and an unknown job as unlinked", () => {
    const [record] = buildCustodyRecords(
      [event(0, 1, merchant, "private-random-id")],
      { [escrow]: object(0) },
      pkg,
    );
    assert.equal(record.job, null);
    assert.equal(record.payout, null);
    assert.equal(record.parcelWith, "Merchant");
    assert.equal(record.funds, "Held in escrow");
  });

  it("skips events whose escrow object is missing", () => {
    assert.deepEqual(buildCustodyRecords([event(0, 1)], {}, pkg), []);
  });

  it("recognizes only this package's SUI and native USDC escrows", () => {
    assert.deepEqual(
      coinFromEscrowType(
        `${pkg}::escrow::Escrow<0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC>`,
        pkg,
      ),
      { symbol: "USDC", decimals: 6, isUsdc: true },
    );
    assert.equal(
      coinFromEscrowType(`0x${"1".repeat(64)}::escrow::Escrow<0x2::sui::SUI>`, pkg),
      null,
    );
    assert.equal(formatCoinAmount("6000000", { symbol: "USDC", decimals: 6, isUsdc: true }), "6 USDC");
    assert.equal(formatCoinAmount("42", null), "42 base units");
  });
});
