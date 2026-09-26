import { createHash } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import type { TransactionArgument } from "@mysten/sui/transactions";

// Runs sample parcels through the published testnet escrow so /custody has a
// real on-chain record. Fees are testnet SUI: the demo wallets hold no testnet
// USDC, and the contract is coin-generic (production config is native USDC).
type Step = "pickup" | "delivery" | "dispute" | "resolve" | "release";
const PARCELS: { jobId: string; fee: number; steps: Step[] }[] = [
  { jobId: "HL-1044", fee: 6.5, steps: ["pickup", "delivery", "release"] },
  {
    jobId: "HL-1043",
    fee: 6,
    steps: ["pickup", "delivery", "dispute", "resolve"],
  },
  { jobId: "HL-1045", fee: 7, steps: ["pickup"] },
];
const SUI_COIN = "0x2::sui::SUI";
const MIST_PER_FEE_UNIT = 1_000_000;

const env = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const packageId = env("SUI_ESCROW_PACKAGE_ID");
const configId = env("SUI_DEMO_CONFIG_ID");
const operatorCapId = env("SUI_OPERATOR_CAP_ID");
const operator = Ed25519Keypair.fromSecretKey(env("SUI_OPERATOR_PRIVATE_KEY"));
const merchant = Ed25519Keypair.fromSecretKey(
  env("SUI_DEMO_MERCHANT_PRIVATE_KEY"),
);
const courier = Ed25519Keypair.fromSecretKey(
  env("SUI_DEMO_COURIER_PRIVATE_KEY"),
).toSuiAddress();
const client = new SuiGrpcClient({
  network: "testnet",
  baseUrl: "https://fullnode.testnet.sui.io:443",
});

async function execute(signer: Ed25519Keypair, build: (tx: Transaction) => void) {
  const tx = new Transaction();
  tx.setSender(signer.toSuiAddress());
  build(tx);
  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    include: { effects: true, objectTypes: true },
  });
  if (result.$kind !== "Transaction")
    throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
  await client.waitForTransaction({ digest: result.Transaction.digest });
  return result.Transaction;
}

function operatorCall(
  escrowId: string,
  fn: string,
  extra?: (tx: Transaction) => TransactionArgument,
) {
  return execute(operator, (tx) => {
    tx.moveCall({
      target: `${packageId}::escrow::${fn}`,
      typeArguments: [SUI_COIN],
      arguments: [
        tx.object(operatorCapId),
        tx.object(escrowId),
        ...(extra ? [extra(tx)] : []),
      ],
    });
  });
}

for (const parcel of PARCELS) {
  const jobRef = createHash("sha256")
    .update(`haulie:job:${parcel.jobId}`)
    .digest();
  const amount = BigInt(Math.round(parcel.fee * MIST_PER_FEE_UNIT));
  const funded = await execute(merchant, (tx) => {
    const [payment] = tx.splitCoins(tx.gas, [amount]);
    tx.moveCall({
      target: `${packageId}::escrow::fund`,
      typeArguments: [SUI_COIN],
      arguments: [
        tx.object(configId),
        tx.pure.vector("u8", Array.from(jobRef)),
        tx.pure.u64(amount),
        payment,
      ],
    });
  });
  const escrowId = funded.effects.changedObjects.find(
    (object) =>
      object.idOperation === "Created" &&
      funded.objectTypes[object.objectId]?.includes("::escrow::Escrow<"),
  )!.objectId;
  console.log(`${parcel.jobId} escrow ${escrowId}`);
  console.log(`  funded   ${funded.digest}`);
  const assigned = await operatorCall(escrowId, "assign", (tx) =>
    tx.pure.address(courier),
  );
  console.log(`  assigned ${assigned.digest}`);
  for (const step of parcel.steps) {
    const result =
      step === "pickup"
        ? await operatorCall(escrowId, "confirm_pickup")
        : step === "delivery"
          ? await operatorCall(escrowId, "confirm_delivery")
          : step === "release"
            ? await operatorCall(escrowId, "release")
            : step === "resolve"
              ? await operatorCall(escrowId, "resolve_dispute", (tx) =>
                  tx.pure.bool(true),
                )
              : await execute(merchant, (tx) => {
                  tx.moveCall({
                    target: `${packageId}::escrow::merchant_dispute`,
                    typeArguments: [SUI_COIN],
                    arguments: [tx.object(escrowId)],
                  });
                });
    console.log(`  ${step.padEnd(8)} ${result.digest}`);
  }
}
