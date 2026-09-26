import "server-only";

import { createHash } from "node:crypto";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import type { TransactionArgument } from "@mysten/sui/transactions";
import {
  isValidSuiAddress,
  isValidTransactionDigest,
  normalizeSuiAddress,
} from "@mysten/sui/utils";
import { ConfigBcs, EscrowBcs, EscrowEventBcs } from "./bcs";
import { ESCROW_STATE, NATIVE_USDC } from "./types";
import type {
  EscrowAssignment,
  EscrowReceipt,
  EscrowReference,
  EscrowSettlement,
  SuiNetwork,
} from "./types";
import type { SuiClientTypes } from "@mysten/sui/client";

export class SuiIntegrationError extends Error {
  constructor(
    message: string,
    public readonly code = "SUI_REJECTED",
  ) {
    super(message);
    this.name = "SuiIntegrationError";
  }
}

export type EscrowTerminalReceipt = {
  state: "PAID" | "REFUNDED";
  digest: string;
  amount: string;
  payoutAddress: string;
};

/** A dispute cannot freeze funds that have already left escrow. */
export class SuiAlreadySettledError extends SuiIntegrationError {
  constructor(public readonly terminal: EscrowTerminalReceipt) {
    super(
      "Escrow has already settled; reconcile its confirmed outcome.",
      "ALREADY_SETTLED",
    );
    this.name = "SuiAlreadySettledError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new SuiIntegrationError(
      `Missing ${name}; live escrow is unavailable.`,
      "CONFIGURATION_REQUIRED",
    );
  return value;
}

function address(value: string): string {
  if (!isValidSuiAddress(value) || BigInt(value) === 0n) {
    throw new SuiIntegrationError("A valid nonzero Sui address is required.");
  }
  return normalizeSuiAddress(value);
}

function amount(value: string): string {
  if (
    !/^[1-9][0-9]*$/.test(value) ||
    BigInt(value) > 18_446_744_073_709_551_615n
  ) {
    throw new SuiIntegrationError(
      "USDC amount must be a positive u64 in base units.",
    );
  }
  return value;
}

function configuration() {
  const networkValue = requireEnv("SUI_NETWORK");
  if (networkValue !== "testnet" && networkValue !== "mainnet") {
    throw new SuiIntegrationError(
      "SUI_NETWORK must be testnet or mainnet.",
      "CONFIGURATION_REQUIRED",
    );
  }
  const network: SuiNetwork = networkValue;
  const endpoint = new URL(requireEnv("SUI_GRPC_URL"));
  if (endpoint.protocol !== "https:") {
    throw new SuiIntegrationError(
      "SUI_GRPC_URL must use HTTPS.",
      "CONFIGURATION_REQUIRED",
    );
  }
  return {
    network,
    endpoint: endpoint.toString(),
    packageId: address(requireEnv("SUI_ESCROW_PACKAGE_ID")),
    configId: address(requireEnv("SUI_ESCROW_CONFIG_ID")),
    operatorCapId: address(requireEnv("SUI_OPERATOR_CAP_ID")),
    coinType: NATIVE_USDC[network],
    // Fixed genesis IDs prevent a mislabeled RPC from silently switching chains.
    chainIdentifier: network === "mainnet" ? "35834a8a" : "4c78adac",
    signer: Ed25519Keypair.fromSecretKey(
      requireEnv("SUI_OPERATOR_PRIVATE_KEY"),
    ),
  };
}

/** Syntactic readiness only. Live calls also verify chain/config/capability. */
export function escrowConfigurationReady(): boolean {
  try {
    configuration();
    return true;
  } catch {
    return false;
  }
}

export function escrowJobReference(jobId: string): number[] {
  if (!jobId || jobId.length > 160)
    throw new SuiIntegrationError("Invalid job reference.");
  return Array.from(
    createHash("sha256").update(`haulie:job:${jobId}`).digest(),
  );
}

async function context() {
  const config = configuration();
  const client = new SuiGrpcClient({
    network: config.network,
    baseUrl: config.endpoint,
  });
  const [chain, configResponse, capResponse] = await Promise.all([
    client.getChainIdentifier({ signal: AbortSignal.timeout(15_000) }),
    client.getObject({
      objectId: config.configId,
      include: { content: true },
      signal: AbortSignal.timeout(15_000),
    }),
    client.getObject({
      objectId: config.operatorCapId,
      signal: AbortSignal.timeout(15_000),
    }),
  ]);
  if (chain.chainIdentifier !== config.chainIdentifier)
    throw new SuiIntegrationError(
      "Sui RPC network does not match configuration.",
    );
  const object = configResponse.object;
  if (
    object.type !== `${config.packageId}::escrow::Config<${config.coinType}>` ||
    object.owner.$kind !== "Immutable"
  ) {
    throw new SuiIntegrationError(
      "Escrow configuration must be the immutable native USDC configuration.",
    );
  }
  const parsed = ConfigBcs.parse(object.content);
  const cap = capResponse.object;
  if (
    parsed.operator_cap !== config.operatorCapId ||
    cap.type !== `${config.packageId}::escrow::OperatorCap` ||
    cap.owner.$kind !== "AddressOwner" ||
    cap.owner.AddressOwner !== config.signer.toSuiAddress()
  )
    throw new SuiIntegrationError(
      "The configured operator does not own this escrow capability.",
    );
  return { client, config };
}

type Context = Awaited<ReturnType<typeof context>>;

async function readEscrow(ctx: Context, input: EscrowReference) {
  const { object } = await ctx.client.getObject({
    objectId: address(input.escrowId),
    include: { content: true, previousTransaction: true },
    signal: AbortSignal.timeout(15_000),
  });
  if (
    object.type !==
      `${ctx.config.packageId}::escrow::Escrow<${ctx.config.coinType}>` ||
    object.owner.$kind !== "Shared"
  ) {
    throw new SuiIntegrationError("Object is not a native USDC Haulie escrow.");
  }
  const data = EscrowBcs.parse(object.content);
  if (
    data.id !== address(input.escrowId) ||
    data.config_id !== ctx.config.configId ||
    data.operator_cap !== ctx.config.operatorCapId ||
    !sameReference(data.job_ref, input.jobId)
  )
    throw new SuiIntegrationError(
      "Escrow does not belong to this job or operator.",
    );
  const terminal =
    data.state === ESCROW_STATE.PAID || data.state === ESCROW_STATE.REFUNDED;
  if (
    (terminal && data.funds !== "0") ||
    (!terminal && data.funds !== data.amount)
  ) {
    throw new SuiIntegrationError(
      "Escrow balance is inconsistent with its state.",
    );
  }
  return { ...data, previousTransaction: object.previousTransaction };
}

function sameReference(reference: number[], jobId: string) {
  return Buffer.from(reference).equals(Buffer.from(escrowJobReference(jobId)));
}

function matchingEvent(
  events: SuiClientTypes.Event[],
  ctx: Context,
  input: EscrowReference,
  kind: number,
  expectedAmount?: string,
  recipient?: string,
) {
  return events.some((event) => {
    if (event.eventType !== `${ctx.config.packageId}::escrow::EscrowEvent`)
      return false;
    const data = EscrowEventBcs.parse(event.bcs);
    return (
      data.escrow_id === address(input.escrowId) &&
      sameReference(data.job_ref, input.jobId) &&
      data.kind === kind &&
      (!expectedAmount || data.amount === expectedAmount) &&
      (!recipient || data.recipient === address(recipient))
    );
  });
}

async function verifiedReceipt(
  ctx: Context,
  input: EscrowReference,
  digest: string | null,
  kind: number,
  expectedAmount?: string,
  recipient?: string,
) {
  if (!digest || !isValidTransactionDigest(digest))
    throw new SuiIntegrationError("Missing valid Sui transaction digest.");
  const result = await ctx.client.waitForTransaction({
    digest,
    include: { events: true },
    timeout: 20_000,
    signal: AbortSignal.timeout(22_000),
  });
  if (result.$kind !== "Transaction" || !result.Transaction.status.success)
    throw new SuiIntegrationError("Sui transaction did not succeed.");
  if (
    !matchingEvent(
      result.Transaction.events,
      ctx,
      input,
      kind,
      expectedAmount,
      recipient,
    )
  ) {
    throw new SuiIntegrationError(
      "Sui transaction does not contain the expected escrow event.",
    );
  }
  return result.Transaction.digest;
}

async function terminalReceipt(
  ctx: Context,
  input: EscrowReference,
  escrow: Awaited<ReturnType<typeof readEscrow>>,
): Promise<EscrowTerminalReceipt | null> {
  if (
    escrow.state !== ESCROW_STATE.PAID &&
    escrow.state !== ESCROW_STATE.REFUNDED
  )
    return null;
  return {
    state: escrow.state === ESCROW_STATE.PAID ? "PAID" : "REFUNDED",
    digest: await verifiedReceipt(
      ctx,
      input,
      escrow.previousTransaction,
      escrow.state,
      escrow.amount,
      escrow.state === ESCROW_STATE.PAID ? escrow.payout : escrow.merchant,
    ),
    amount: escrow.amount,
    payoutAddress: escrow.payout,
  };
}

/** Read-only recovery for a chain success whose database commit was lost. */
export async function reconcileEscrowTerminal(
  input: EscrowReference & { amount: string; payoutAddress?: string },
): Promise<EscrowTerminalReceipt | null> {
  const ctx = await context();
  const escrow = await readEscrow(ctx, input);
  if (escrow.amount !== amount(input.amount))
    throw new SuiIntegrationError(
      "Funded escrow amount does not match the job.",
    );
  if (input.payoutAddress && escrow.payout !== address(input.payoutAddress)) {
    throw new SuiIntegrationError(
      "Escrow payout differs from the acceptance snapshot.",
    );
  }
  return terminalReceipt(ctx, input, escrow);
}

/** Merchant signs this transaction; the server never spends merchant assets. */
export async function prepareEscrowFunding(input: {
  jobId: string;
  amount: string;
  merchantWallet: string;
}) {
  const ctx = await context();
  const tx = new Transaction();
  tx.setSender(address(input.merchantWallet));
  tx.setGasBudget(50_000_000);
  const payment = tx.coin({
    type: ctx.config.coinType,
    balance: amount(input.amount),
  });
  tx.moveCall({
    target: `${ctx.config.packageId}::escrow::fund`,
    typeArguments: [ctx.config.coinType],
    arguments: [
      tx.object(ctx.config.configId),
      tx.pure.vector("u8", escrowJobReference(input.jobId)),
      tx.pure.u64(input.amount),
      payment,
    ],
  });
  return {
    transaction: await tx.toJSON(),
    network: ctx.config.network,
    coinType: ctx.config.coinType,
  };
}

export async function confirmEscrowFunding(
  input: EscrowReference & {
    amount: string;
    digest: string;
    merchantWallet: string;
  },
) {
  const ctx = await context();
  const escrow = await readEscrow(ctx, input);
  if (
    escrow.state !== ESCROW_STATE.FUNDED ||
    escrow.amount !== amount(input.amount) ||
    escrow.merchant !== address(input.merchantWallet) ||
    escrow.previousTransaction !== input.digest
  )
    throw new SuiIntegrationError(
      "Funding amount, merchant, digest, or escrow state does not match the job.",
    );
  const digest = await verifiedReceipt(
    ctx,
    input,
    input.digest,
    ESCROW_STATE.FUNDED,
    input.amount,
    input.merchantWallet,
  );
  return { digest, escrowId: address(input.escrowId) };
}

type Mutation = {
  functionName:
    | "assign"
    | "unassign"
    | "confirm_pickup"
    | "confirm_delivery"
    | "dispute"
    | "refund"
    | "release"
    | "resolve_dispute";
  expectedStates: number[];
  targetState: number;
  eventKind?: number;
  payoutAddress?: string;
  amount?: string;
  payCourier?: boolean;
};

/** Call while holding the database job lock. A crash after execution is recovered
 * from the immutable terminal state and its actual event/digest, never by a
 * second free-standing transfer. Contract transitions additionally reject races. */
async function mutate(
  input: EscrowReference,
  mutation: Mutation,
): Promise<EscrowReceipt> {
  const ctx = await context();
  const escrow = await readEscrow(ctx, input);
  if (mutation.amount && escrow.amount !== amount(mutation.amount))
    throw new SuiIntegrationError(
      "Payout amount does not match funded escrow.",
    );
  const payoutAddress = mutation.payoutAddress
    ? address(mutation.payoutAddress)
    : undefined;
  if (
    payoutAddress &&
    mutation.functionName !== "assign" &&
    escrow.payout !== payoutAddress
  ) {
    throw new SuiIntegrationError(
      "Payout address differs from the acceptance snapshot.",
    );
  }
  const kind = mutation.eventKind ?? mutation.targetState;
  const eventRecipient =
    mutation.targetState === ESCROW_STATE.REFUNDED
      ? escrow.merchant
      : payoutAddress;
  if (escrow.state === mutation.targetState) {
    if (payoutAddress && escrow.payout !== payoutAddress)
      throw new SuiIntegrationError(
        "Existing assignment has a different payout wallet.",
      );
    return {
      digest: await verifiedReceipt(
        ctx,
        input,
        escrow.previousTransaction,
        kind,
        escrow.amount,
        eventRecipient,
      ),
      reconciled: true,
    };
  }
  if (mutation.functionName === "dispute") {
    const terminal = await terminalReceipt(ctx, input, escrow);
    if (terminal) throw new SuiAlreadySettledError(terminal);
  }
  if (!mutation.expectedStates.includes(escrow.state))
    throw new SuiIntegrationError(
      "Escrow state does not permit this transition.",
    );
  const tx = new Transaction();
  tx.setSender(ctx.config.signer.toSuiAddress());
  tx.setGasBudget(50_000_000);
  const args: TransactionArgument[] = [
    tx.object(ctx.config.operatorCapId),
    tx.object(address(input.escrowId)),
  ];
  if (mutation.functionName === "assign")
    args.push(tx.pure.address(payoutAddress!));
  if (mutation.functionName === "resolve_dispute")
    args.push(tx.pure.bool(mutation.payCourier!));
  tx.moveCall({
    target: `${ctx.config.packageId}::escrow::${mutation.functionName}`,
    typeArguments: [ctx.config.coinType],
    arguments: args,
  });
  const result = await ctx.client.signAndExecuteTransaction({
    signer: ctx.config.signer,
    transaction: tx,
    include: { events: true },
    signal: AbortSignal.timeout(25_000),
  });
  if (result.$kind !== "Transaction" || !result.Transaction.status.success)
    throw new SuiIntegrationError(
      "Sui escrow transaction failed; reconciliation is required before retrying.",
    );
  const digest = await verifiedReceipt(
    ctx,
    input,
    result.Transaction.digest,
    kind,
    escrow.amount,
    eventRecipient,
  );
  return { digest, reconciled: false };
}

export function assignEscrow(input: EscrowAssignment) {
  return mutate(input, {
    functionName: "assign",
    expectedStates: [0],
    targetState: 1,
    payoutAddress: input.payoutAddress,
  });
}
export function unassignEscrow(input: EscrowReference) {
  return mutate(input, {
    functionName: "unassign",
    expectedStates: [1],
    targetState: 0,
    eventKind: 7,
  });
}
export function confirmEscrowPickup(input: EscrowReference) {
  return mutate(input, {
    functionName: "confirm_pickup",
    expectedStates: [1],
    targetState: 2,
  });
}
export function confirmEscrowDelivery(input: EscrowReference) {
  return mutate(input, {
    functionName: "confirm_delivery",
    expectedStates: [2],
    targetState: 3,
  });
}
export function disputeEscrow(input: EscrowReference) {
  return mutate(input, {
    functionName: "dispute",
    expectedStates: [1, 2, 3],
    targetState: 4,
  });
}
export function refundEscrow(input: EscrowReference) {
  return mutate(input, {
    functionName: "refund",
    expectedStates: [0],
    targetState: 6,
  });
}
export function settleEscrow(input: EscrowSettlement) {
  return mutate(input, {
    functionName: "release",
    expectedStates: [3],
    targetState: 5,
    payoutAddress: input.payoutAddress,
    amount: input.amount,
  });
}
export async function resolveEscrowDispute(
  input: EscrowReference & { payCourier: boolean },
) {
  const ctx = await context();
  const escrow = await readEscrow(ctx, input);
  const terminal = await terminalReceipt(ctx, input, escrow);
  if (terminal) {
    if ((terminal.state === "PAID") !== input.payCourier) {
      throw new SuiAlreadySettledError(terminal);
    }
    return { digest: terminal.digest, reconciled: true };
  }
  // A database dispute survives RPC outages. Synchronize its chain lock before
  // resolution, while allowing a prior terminal success to reconcile above.
  if (escrow.state !== ESCROW_STATE.DISPUTED) await disputeEscrow(input);
  return mutate(input, {
    functionName: "resolve_dispute",
    expectedStates: [4],
    targetState: input.payCourier ? 5 : 6,
    payCourier: input.payCourier,
  });
}
