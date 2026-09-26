import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  isValidSuiAddress,
  normalizeStructTag,
  normalizeSuiAddress,
} from "@mysten/sui/utils";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { EscrowBcs } from "./bcs";
import { LIVE_ESCROW, handoffMessage, jobReferenceInput } from "./live-escrow-config";

export class LiveEscrowError extends Error {
  constructor(
    message: string,
    public readonly status = 409,
  ) {
    super(message);
    this.name = "LiveEscrowError";
  }
}

const client = new SuiGrpcClient({
  network: LIVE_ESCROW.network,
  baseUrl: "https://fullnode.testnet.sui.io:443",
});
const escrowType = normalizeStructTag(
  `${LIVE_ESCROW.packageId}::escrow::Escrow<${LIVE_ESCROW.coinType}>`,
);

function operator() {
  const key = process.env.SUI_OPERATOR_PRIVATE_KEY?.trim();
  if (!key) throw new LiveEscrowError("On-chain escrow is not configured.", 503);
  return Ed25519Keypair.fromSecretKey(key);
}

export function liveEscrowReady() {
  return !!process.env.SUI_OPERATOR_PRIVATE_KEY?.trim();
}

export function normalizeEscrowId(value: string) {
  if (!isValidSuiAddress(value))
    throw new LiveEscrowError("Invalid escrow object.", 400);
  return normalizeSuiAddress(value);
}

export type LiveEscrow = {
  id: string;
  merchant: string;
  payout: string;
  amount: string;
  state: number;
  previousTransaction: string | null;
};

/** Accepts only this package's SUI escrows created under the demo config for this job. */
export async function readLiveEscrow(
  escrowId: string,
  jobId: string,
): Promise<LiveEscrow> {
  const { object } = await client.getObject({
    objectId: normalizeEscrowId(escrowId),
    include: { content: true, previousTransaction: true },
    signal: AbortSignal.timeout(15_000),
  });
  if (
    normalizeStructTag(object.type) !== escrowType ||
    object.owner.$kind !== "Shared"
  )
    throw new LiveEscrowError("This is not a Haulie delivery escrow.", 400);
  const data = EscrowBcs.parse(object.content);
  const expectedRef = createHash("sha256")
    .update(jobReferenceInput(jobId))
    .digest();
  if (
    data.config_id !== normalizeSuiAddress(LIVE_ESCROW.configId) ||
    data.operator_cap !== normalizeSuiAddress(LIVE_ESCROW.operatorCapId) ||
    !Buffer.from(data.job_ref).equals(expectedRef)
  )
    throw new LiveEscrowError("This escrow belongs to a different delivery.", 400);
  return {
    id: data.id,
    merchant: data.merchant,
    payout: data.payout,
    amount: data.amount,
    state: data.state,
    previousTransaction: object.previousTransaction,
  };
}

type Call = "assign" | "unassign" | "confirm_pickup" | "confirm_delivery" | "release";

export async function operatorCalls(
  escrowId: string,
  calls: Call[],
  payout?: string,
): Promise<string> {
  const signer = operator();
  const tx = new Transaction();
  tx.setSender(signer.toSuiAddress());
  tx.setGasBudget(20_000_000);
  for (const call of calls) {
    tx.moveCall({
      target: `${LIVE_ESCROW.packageId}::escrow::${call}`,
      typeArguments: [LIVE_ESCROW.coinType],
      arguments: [
        tx.object(LIVE_ESCROW.operatorCapId),
        tx.object(escrowId),
        ...(call === "assign" ? [tx.pure.address(payout!)] : []),
      ],
    });
  }
  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    signal: AbortSignal.timeout(25_000),
  });
  if (result.$kind !== "Transaction")
    throw new LiveEscrowError(
      "The Sui transaction failed. Refresh and check the delivery before retrying.",
      502,
    );
  await client.waitForTransaction({
    digest: result.Transaction.digest,
    timeout: 20_000,
  });
  return result.Transaction.digest;
}

export async function verifyMerchantHandoff(
  escrow: LiveEscrow,
  jobId: string,
  signature: string,
) {
  try {
    await verifyPersonalMessageSignature(
      new TextEncoder().encode(handoffMessage(jobId, escrow.id)),
      signature,
      { address: escrow.merchant, client },
    );
  } catch {
    throw new LiveEscrowError(
      "The handoff must be signed by the wallet that funded this delivery.",
      403,
    );
  }
}

function receiptMac(escrowId: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`haulie:receipt:${normalizeSuiAddress(escrowId)}`)
    .digest("base64url");
}

/** Issued to the merchant at handoff; the recipient presents it to release the fee. */
export function receiptToken(escrowId: string, secret: string) {
  return receiptMac(escrowId, secret);
}

export function validReceiptToken(escrowId: string, token: string, secret: string) {
  const expected = Buffer.from(receiptMac(escrowId, secret));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
