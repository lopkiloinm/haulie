import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import {
  LIVE_ESCROW,
  feeInMist,
  handoffMessage,
  jobReferenceInput,
} from "./live-escrow-config";

async function wallet() {
  const { dAppKit } = await import("./wallet");
  const connection = dAppKit.stores.$connection.get();
  if (!connection.account)
    throw new Error("Connect your Sui wallet in Connections first.");
  if (!connection.account.chains.includes("sui:testnet"))
    throw new Error("Choose a wallet account that supports Sui testnet.");
  return { kit: dAppKit, account: connection.account };
}

async function execute(build: (tx: Transaction) => void) {
  const { kit, account } = await wallet();
  const tx = new Transaction();
  tx.setSender(account.address);
  build(tx);
  const signed = await kit.signTransaction({ transaction: tx, account });
  const result = await kit.getClient().executeTransaction({
    transaction: fromBase64(signed.bytes),
    signatures: [signed.signature],
    include: { effects: true, objectTypes: true },
  });
  if (result.$kind !== "Transaction")
    throw new Error(
      result.FailedTransaction.status.error?.message ||
        "The transaction failed on Sui.",
    );
  await kit.getClient().waitForTransaction({ digest: result.Transaction.digest });
  return result.Transaction;
}

async function jobReference(jobId: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(jobReferenceInput(jobId)),
  );
  return Array.from(new Uint8Array(digest));
}

/** The merchant's wallet funds a new shared escrow with the exact courier fee. */
export async function fundEscrow(jobId: string, fee: number) {
  const amount = feeInMist(fee);
  const reference = await jobReference(jobId);
  const result = await execute((tx) => {
    const [payment] = tx.splitCoins(tx.gas, [amount]);
    tx.moveCall({
      target: `${LIVE_ESCROW.packageId}::escrow::fund`,
      typeArguments: [LIVE_ESCROW.coinType],
      arguments: [
        tx.object(LIVE_ESCROW.configId),
        tx.pure.vector("u8", reference),
        tx.pure.u64(amount),
        payment,
      ],
    });
  });
  const escrowId = result.effects.changedObjects.find(
    (object) =>
      object.idOperation === "Created" &&
      result.objectTypes[object.objectId]?.includes("::escrow::Escrow<"),
  )?.objectId;
  if (!escrowId) throw new Error("Sui did not return the new escrow.");
  return { escrowId, digest: result.digest };
}

export async function refundEscrow(escrowId: string) {
  const result = await execute((tx) => {
    tx.moveCall({
      target: `${LIVE_ESCROW.packageId}::escrow::merchant_refund`,
      typeArguments: [LIVE_ESCROW.coinType],
      arguments: [tx.object(escrowId)],
    });
  });
  return result.digest;
}

export async function signHandoff(jobId: string, escrowId: string) {
  const { kit, account } = await wallet();
  const { signature } = await kit.signPersonalMessage({
    account,
    message: new TextEncoder().encode(handoffMessage(jobId, escrowId)),
  });
  return signature;
}

export async function escrowRequest<T>(
  operation: "assign" | "unassign" | "handoff" | "deliver",
  body: Record<string, string>,
): Promise<T & { digest: string }> {
  const response = await fetch(`/api/escrow/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Sui is unavailable.");
  return result;
}
