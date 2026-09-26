import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiAddress, toBase58 } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import { ConfigBcs, EscrowBcs, EscrowEventBcs } from "./bcs";
import { NATIVE_USDC } from "./types";
import {
  SuiAlreadySettledError, SuiIntegrationError, disputeEscrow,
  escrowConfigurationReady, escrowJobReference, reconcileEscrowTerminal,
  resolveEscrowDispute, settleEscrow,
} from "./server";

// All RPC methods are mocked; these tests never send a transaction or use funds.
const packageId = normalizeSuiAddress("0x111");
const configId = normalizeSuiAddress("0x222");
const capId = normalizeSuiAddress("0x333");
const escrowId = normalizeSuiAddress("0x444");
const payout = normalizeSuiAddress("0x555");
const merchant = normalizeSuiAddress("0x666");
const signer = Ed25519Keypair.generate();
const input = { escrowId, jobId: "job-regression-test", payoutAddress: payout, amount: "6000000" };
const envKeys = ["SUI_NETWORK", "SUI_GRPC_URL", "SUI_ESCROW_PACKAGE_ID", "SUI_ESCROW_CONFIG_ID", "SUI_OPERATOR_CAP_ID", "SUI_OPERATOR_PRIVATE_KEY"] as const;
let originalEnv: (string | undefined)[];
let state = 5;
let calls: string[];
let network = "4c78adac";
let objectType = "";

function receiptDigest() { return toBase58(new Uint8Array(32).fill(state + 11)); }
function chainResult() {
  return {
    $kind: "Transaction", Transaction: {
      status: { success: true }, digest: receiptDigest(),
      events: [{
        eventType: `${packageId}::escrow::EscrowEvent`,
        bcs: EscrowEventBcs.serialize({
          escrow_id: escrowId, job_ref: escrowJobReference(input.jobId),
          kind: state, amount: input.amount, recipient: state === 6 ? merchant : payout,
        }).toBytes(),
      }],
    },
  };
}

beforeEach(() => {
  originalEnv = envKeys.map(key => process.env[key]);
  ["testnet", "https://fullnode.testnet.sui.io:443", packageId, configId, capId, signer.getSecretKey()]
    .forEach((value, index) => { process.env[envKeys[index]] = value; });
  state = 5;
  calls = [];
  network = "4c78adac";
  objectType = `${packageId}::escrow::Escrow<${NATIVE_USDC.testnet}>`;
  mock.method(SuiGrpcClient.prototype, "getChainIdentifier", async () => ({ chainIdentifier: network }));
  mock.method(SuiGrpcClient.prototype, "getObject", async ({ objectId }: { objectId: string }) => {
    if (objectId === configId) return { object: {
      type: `${packageId}::escrow::Config<${NATIVE_USDC.testnet}>`, owner: { $kind: "Immutable" },
      content: ConfigBcs.serialize({ id: configId, operator_cap: capId }).toBytes(),
    } };
    if (objectId === capId) return { object: {
      type: `${packageId}::escrow::OperatorCap`, owner: { $kind: "AddressOwner", AddressOwner: signer.toSuiAddress() },
    } };
    assert.equal(objectId, escrowId);
    return { object: {
      type: objectType, owner: { $kind: "Shared" }, previousTransaction: receiptDigest(),
      content: EscrowBcs.serialize({
        id: escrowId, config_id: configId, operator_cap: capId, job_ref: escrowJobReference(input.jobId),
        merchant, amount: input.amount, funds: state === 5 || state === 6 ? "0" : input.amount,
        payout, state,
      }).toBytes(),
    } };
  });
  mock.method(SuiGrpcClient.prototype, "waitForTransaction", async () => chainResult());
  mock.method(SuiGrpcClient.prototype, "signAndExecuteTransaction", async ({ transaction }: { transaction: Transaction }) => {
    const command = transaction.getData().commands[0];
    assert.ok(command?.MoveCall);
    calls.push(command.MoveCall.function);
    if (command.MoveCall.function === "dispute") state = 4;
    else if (command.MoveCall.function === "resolve_dispute") state = 5;
    else throw new Error(`Unexpected mutation: ${command.MoveCall.function}`);
    return chainResult();
  });
});

afterEach(() => {
  mock.restoreAll();
  envKeys.forEach((key, index) => {
    if (originalEnv[index] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[index];
  });
});

test("missing operator configuration fails closed", async () => {
  delete process.env.SUI_OPERATOR_PRIVATE_KEY;
  assert.equal(escrowConfigurationReady(), false);
  await assert.rejects(settleEscrow(input), error => error instanceof SuiIntegrationError && error.code === "CONFIGURATION_REQUIRED");
  assert.deepEqual(calls, []);
});

test("mislabeled RPC network cannot authorize a mutation", async () => {
  network = "35834a8a";
  await assert.rejects(settleEscrow(input), /network does not match/);
  assert.deepEqual(calls, []);
});

test("non-native token escrows are rejected", async () => {
  objectType = `${packageId}::escrow::Escrow<0x2::sui::SUI>`;
  await assert.rejects(reconcileEscrowTerminal(input), /not a native USDC/);
  assert.deepEqual(calls, []);
});

test("a payment whose database commit was lost reconciles without another transaction", async () => {
  const receipt = await settleEscrow(input);
  assert.equal(receipt.reconciled, true);
  assert.equal(receipt.digest, receiptDigest());
  assert.deepEqual(calls, []);
});

test("terminal reconciliation verifies amount and payout snapshot", async () => {
  await assert.rejects(reconcileEscrowTerminal({ ...input, amount: "7000000" }), /amount does not match/);
  await assert.rejects(reconcileEscrowTerminal({ ...input, payoutAddress: merchant }), /snapshot/);
  assert.equal((await reconcileEscrowTerminal(input))?.state, "PAID");
  assert.deepEqual(calls, []);
});

test("already-paid funds cannot be reported as newly frozen", async () => {
  await assert.rejects(disputeEscrow(input), error => error instanceof SuiAlreadySettledError
    && error.terminal.state === "PAID" && error.terminal.digest === receiptDigest());
  assert.deepEqual(calls, []);
});

test("dispute resolution retry reconciles payment before attempting a new freeze", async () => {
  const receipt = await resolveEscrowDispute({ ...input, payCourier: true });
  assert.equal(receipt.reconciled, true);
  assert.deepEqual(calls, []);
});

test("dispute resolution retry reconciles refund before attempting a new freeze", async () => {
  state = 6;
  const receipt = await resolveEscrowDispute({ ...input, payCourier: false });
  assert.equal(receipt.reconciled, true);
  assert.deepEqual(calls, []);
});

test("a conflicting resolution returns the actual terminal receipt", async () => {
  await assert.rejects(resolveEscrowDispute({ ...input, payCourier: false }), error => error instanceof SuiAlreadySettledError && error.terminal.state === "PAID");
  assert.deepEqual(calls, []);
});

test("a locally frozen dispute synchronizes the chain lock before resolution", async () => {
  state = 3;
  const receipt = await resolveEscrowDispute({ ...input, payCourier: true });
  assert.equal(receipt.reconciled, false);
  assert.deepEqual(calls, ["dispute", "resolve_dispute"]);
});
