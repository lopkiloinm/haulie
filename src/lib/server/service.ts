import { randomBytes, randomUUID } from "node:crypto";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import {
  assignEscrow,
  confirmEscrowDelivery,
  confirmEscrowFunding,
  confirmEscrowPickup,
  disputeEscrow,
  refundEscrow,
  resolveEscrowDispute,
  settleEscrow,
  unassignEscrow,
  reconcileEscrowTerminal,
  SuiAlreadySettledError,
  type EscrowTerminalReceipt,
} from "@/lib/sui/server";
import type { Actor } from "./auth";
import { db, rateLimit, type Transaction } from "./db";
import {
  assertCourier,
  assertDeliveryReady,
  assertJobStage,
  assertProofRequest,
  digestToken,
  type Courier,
  type Job,
  type Stage,
  type VerificationRequest,
} from "./domain";
import { ApiError, requireCondition, requiredEnv } from "./errors";
import { createWorldContext, verifyWorldProof } from "./world";

async function lockJob(
  tx: Transaction,
  id: string,
): Promise<Job & Record<string, unknown>> {
  // One pilot operator gas wallet is shared across serverless invocations. Serialize
  // writes in PostgreSQL so separate jobs cannot race to spend its same gas coin.
  await tx`SELECT pg_advisory_xact_lock(726224031)`;
  const rows = await tx`SELECT * FROM jobs WHERE id = ${id} FOR UPDATE`;
  requireCondition(rows[0], "NOT_FOUND", "Delivery not found.", 404);
  return rows[0] as Job & Record<string, unknown>;
}
async function lockCourier(tx: Transaction, id: string) {
  const rows = await tx`SELECT * FROM couriers WHERE id = ${id} FOR UPDATE`;
  requireCondition(
    rows[0],
    "ONBOARDING_REQUIRED",
    "This courier account has not been provisioned.",
    403,
  );
  return rows[0] as Courier;
}
function merchantOwns(actor: Actor, job: Job) {
  requireCondition(
    actor.role === "merchant" && job.merchant_id === actor.id,
    "FORBIDDEN",
    "Only this delivery's merchant can perform that action.",
    403,
  );
}
function involved(actor: Actor, job: Job) {
  requireCondition(
    actor.role === "operator" ||
      job.merchant_id === actor.id ||
      job.assigned_courier_id === actor.id,
    "FORBIDDEN",
    "This delivery is restricted to its participants.",
    403,
  );
}
function chainJob(job: Job) {
  requireCondition(
    job.escrow_object_id,
    "NOT_FUNDED",
    "This delivery has no confirmed escrow.",
  );
  return { escrowId: job.escrow_object_id, jobId: job.id };
}
async function event(
  tx: Transaction,
  jobId: string,
  actor: Actor | null,
  type: string,
  digest: string | null = null,
) {
  await tx`INSERT INTO job_events (job_id, actor_id, actor_role, event_type, sui_digest) VALUES (${jobId}, ${actor?.id ?? null}, ${actor?.role ?? "recipient"}, ${type}, ${digest})`;
}
async function proofStages(
  tx: Transaction,
  job: Job & Record<string, unknown>,
) {
  const proofs =
    await tx`SELECT stage FROM delivery_verifications WHERE job_id = ${job.id} AND courier_id = ${job.assigned_courier_id} AND assignment_generation = ${Number(job.assignment_generation)}`;
  return proofs.map((row) => String(row.stage));
}

async function recordTerminal(
  tx: Transaction,
  job: Job,
  actor: Actor | null,
  receipt: EscrowTerminalReceipt,
) {
  requireCondition(
    receipt.amount === String(job.fee_usdc),
    "ESCROW_MISMATCH",
    "The recorded escrow amount differs from this delivery.",
  );
  if (receipt.state === "PAID") {
    requireCondition(
      job.payout_address && receipt.payoutAddress === job.payout_address,
      "ESCROW_MISMATCH",
      "The settled wallet differs from the acceptance snapshot.",
    );
    await tx`INSERT INTO settlements (job_id, payout_amount, wallet_address, digest, status) VALUES (${job.id}, ${job.fee_usdc}, ${job.payout_address}, ${receipt.digest}, 'paid') ON CONFLICT (job_id) DO UPDATE SET status = 'paid', digest = ${receipt.digest}, last_error = NULL, updated_at = now()`;
  }
  await tx`UPDATE jobs SET state = ${receipt.state}, updated_at = now() WHERE id = ${job.id}`;
  await event(
    tx,
    job.id,
    actor,
    "PREVIOUS_CHAIN_SETTLEMENT_RECONCILED",
    receipt.digest,
  );
  return {
    state: receipt.state,
    digest: receipt.digest,
    message:
      "Escrow had already settled on-chain. The recorded outcome has been reconciled; transferred funds cannot be frozen.",
  };
}

async function synchronizeDispute(
  tx: Transaction,
  job: Job,
  actor: Actor | null,
) {
  let terminal: EscrowTerminalReceipt | null = null;
  let digest: string | null = null;
  try {
    terminal = await reconcileEscrowTerminal({
      ...chainJob(job),
      amount: String(job.fee_usdc),
      ...(job.payout_address ? { payoutAddress: job.payout_address } : {}),
    });
    if (!terminal) digest = (await disputeEscrow(chainJob(job))).digest;
  } catch (error) {
    if (error instanceof SuiAlreadySettledError) terminal = error.terminal;
    // A chain outage must never prevent the local freeze below.
  }
  return {
    digest,
    terminal: terminal ? await recordTerminal(tx, job, actor, terminal) : null,
  };
}

export async function listJobs(actor: Actor) {
  if (actor.role === "courier") {
    // Public offers disclose areas, never parcel addresses or merchant account identifiers.
    return db()`SELECT id, parcel_category, pickup_area, destination_area, fee_usdc::text, state, delivery_deadline, cancellation_rules, escrow_object_id FROM jobs WHERE (state = 'FUNDED' AND delivery_deadline > now()) OR assigned_courier_id = ${actor.id} ORDER BY created_at DESC LIMIT 100`;
  }
  if (actor.role === "merchant")
    return db()`SELECT id, parcel_category, pickup_area, destination_area, fee_usdc::text, state, delivery_deadline, escrow_object_id FROM jobs WHERE merchant_id = ${actor.id} ORDER BY created_at DESC LIMIT 100`;
  return db()`SELECT id, parcel_category, pickup_area, destination_area, fee_usdc::text, state, delivery_deadline, escrow_object_id FROM jobs ORDER BY created_at DESC LIMIT 100`;
}

export async function getJob(actor: Actor, id: string) {
  const rows = await db()`SELECT * FROM jobs WHERE id = ${id}`;
  requireCondition(rows[0], "NOT_FOUND", "Delivery not found.", 404);
  involved(actor, rows[0] as Job);
  const events =
    await db()`SELECT id, actor_role, event_type, sui_digest, created_at FROM job_events WHERE job_id = ${id} ORDER BY id`;
  return { job: rows[0], events };
}

export async function createJob(
  actor: Actor,
  input: {
    parcelCategory: string;
    pickupArea: string;
    destinationArea: string;
    pickupAddress: string;
    destinationAddress: string;
    feeUsdc: string;
    deliveryDeadline: string;
    cancellationRules: string;
  },
) {
  await rateLimit(actor.id, "create-job", 15);
  const id = randomUUID();
  requireCondition(
    new Date(input.deliveryDeadline).getTime() > Date.now() &&
      new Date(input.deliveryDeadline).getTime() < Date.now() + 30 * 86400_000,
    "INVALID_DEADLINE",
    "Choose a delivery deadline within the next 30 days.",
    400,
  );
  return db().begin(async (tx) => {
    await tx`INSERT INTO jobs (id, merchant_id, parcel_category, pickup_area, destination_area, pickup_address, destination_address, fee_usdc, delivery_deadline, cancellation_rules) VALUES (${id}, ${actor.id}, ${input.parcelCategory}, ${input.pickupArea}, ${input.destinationArea}, ${input.pickupAddress}, ${input.destinationAddress}, ${input.feeUsdc}, ${input.deliveryDeadline}, ${input.cancellationRules})`;
    await event(tx, id, actor, "JOB_CREATED");
    return { id, state: "DRAFT" };
  });
}

export async function fundJob(
  actor: Actor,
  id: string,
  escrowId: string,
  digest: string,
) {
  return db().begin(async (tx) => {
    const job = await lockJob(tx, id);
    merchantOwns(actor, job);
    requireCondition(
      actor.wallet_address,
      "WALLET_REQUIRED",
      "The merchant's verified funding wallet must be provisioned first.",
    );
    if (
      job.state === "FUNDED" &&
      job.escrow_object_id === escrowId &&
      job.funding_digest === digest
    )
      return { state: job.state, digest };
    requireCondition(
      job.state === "DRAFT",
      "INVALID_STATE",
      "Only a draft delivery can be funded.",
    );
    const confirmation = await confirmEscrowFunding({
      jobId: id,
      amount: String(job.fee_usdc),
      escrowId,
      digest,
      merchantWallet: actor.wallet_address,
    });
    await tx`UPDATE jobs SET state = 'FUNDED', escrow_object_id = ${confirmation.escrowId}, funding_digest = ${confirmation.digest}, updated_at = now() WHERE id = ${id}`;
    await event(tx, id, actor, "ESCROW_FUNDED", confirmation.digest);
    return { state: "FUNDED", digest: confirmation.digest };
  });
}

export async function createProofRequest(
  actor: Actor,
  stage: Stage,
  jobId: string | null,
) {
  await rateLimit(actor.id, "world-request", 10);
  requireCondition(
    (stage === "ACCEPT_JOB" || stage === "CONFIRM_PICKUP") === Boolean(jobId),
    "INVALID_CONTEXT",
    "Delivery checks require a job; enrollment checks do not.",
    400,
  );
  return db().begin(async (tx) => {
    const job = jobId ? await lockJob(tx, jobId) : null;
    const courier = await lockCourier(tx, actor.id);
    assertCourier(courier, Boolean(job));
    if (job) assertJobStage(job, stage, actor.id);
    if (stage === "ENROLL_UNIQUENESS")
      requireCondition(
        !courier.unique_human_verified_at,
        "ALREADY_ENROLLED",
        "Uniqueness enrollment is already complete.",
      );
    if (stage === "ENROLL_SESSION")
      requireCondition(
        courier.unique_human_verified_at && !courier.world_session_id,
        "SESSION_ENROLLMENT_BLOCKED",
        "Complete uniqueness first; existing sessions cannot be replaced automatically.",
      );
    const signed = createWorldContext(stage),
      id = randomUUID();
    await tx`INSERT INTO verification_requests (id, job_id, courier_id, stage, nonce, rp_context, expected_session_id, environment, action, expires_at) VALUES (${id}, ${jobId}, ${actor.id}, ${stage}, ${signed.context.nonce}, ${tx.json(signed.context)}, ${courier.world_session_id}, ${signed.environment}, ${signed.action}, ${signed.expiresAt})`;
    return {
      requestId: id,
      stage,
      jobId,
      appId: signed.appId,
      environment: signed.environment,
      rp_context: signed.context,
      action: signed.action,
      existing_session_id: courier.world_session_id,
      expiresAt: signed.expiresAt,
      credential: "proof_of_human",
      issuerSchemaId: 1,
    };
  });
}

export async function consumeProof(
  actor: Actor,
  requestId: string,
  rawProof: unknown,
) {
  await rateLimit(actor.id, "world-verify", 15);
  const existing =
    await db()`SELECT * FROM verification_requests WHERE id = ${requestId} AND courier_id = ${actor.id}`;
  requireCondition(
    existing[0],
    "NOT_FOUND",
    "Verification request not found.",
    404,
  );
  const expected = existing[0] as VerificationRequest;
  assertProofRequest(expected, actor.id, expected.job_id, expected.stage);
  const verified = await verifyWorldProof(rawProof, expected);
  return db().begin(async (tx) => {
    const job = expected.job_id ? await lockJob(tx, expected.job_id) : null;
    const courier = await lockCourier(tx, actor.id);
    const rows =
      await tx`SELECT * FROM verification_requests WHERE id = ${requestId} FOR UPDATE`;
    const request = rows[0] as VerificationRequest;
    assertProofRequest(request, actor.id, expected.job_id, expected.stage);
    assertCourier(courier, Boolean(job));
    if (job) {
      assertJobStage(job, request.stage, actor.id);
      requireCondition(
        courier.world_session_id === verified.sessionId &&
          request.expected_session_id === courier.world_session_id,
        "WRONG_SESSION",
        "The courier's enrolled session has changed.",
        403,
      );
    }
    const inserted =
      await tx`INSERT INTO used_world_proofs (proof_identifier, courier_id, proof_type) VALUES (${verified.identifier}, ${actor.id}, ${verified.type}) ON CONFLICT DO NOTHING RETURNING proof_identifier`;
    requireCondition(
      inserted.length === 1,
      "PROOF_REPLAY",
      "This proof has already authorized another action.",
    );
    if (request.stage === "ENROLL_UNIQUENESS") {
      requireCondition(
        !courier.unique_human_verified_at,
        "ALREADY_ENROLLED",
        "Unique-human enrollment is already complete.",
      );
      await tx`UPDATE couriers SET unique_human_verified_at = now() WHERE id = ${actor.id}`;
    } else if (request.stage === "ENROLL_SESSION") {
      requireCondition(
        courier.unique_human_verified_at &&
          !courier.world_session_id &&
          verified.sessionId,
        "SESSION_ENROLLMENT_BLOCKED",
        "An existing session cannot be silently replaced.",
      );
      await tx`UPDATE couriers SET world_session_id = ${verified.sessionId} WHERE id = ${actor.id}`;
    } else if (job) {
      let generation = Number(job.assignment_generation);
      if (request.stage === "ACCEPT_JOB") {
        const assignment = await assignEscrow({
          ...chainJob(job),
          payoutAddress: courier.wallet_address!,
        });
        generation += 1;
        await tx`UPDATE jobs SET state = 'ASSIGNED', assigned_courier_id = ${actor.id}, payout_address = ${courier.wallet_address}, assignment_generation = ${generation}, updated_at = now() WHERE id = ${job.id}`;
        await event(
          tx,
          job.id,
          actor,
          "COURIER_ACCEPTANCE_VERIFIED",
          assignment.digest,
        );
      } else {
        const stages = await proofStages(tx, job);
        requireCondition(
          stages.includes("ACCEPT_JOB"),
          "MISSING_ACCEPTANCE",
          "The current assignment has no acceptance proof.",
        );
        await event(tx, job.id, actor, "COURIER_PICKUP_VERIFIED");
      }
      await tx`INSERT INTO delivery_verifications (job_id, courier_id, assignment_generation, stage, verification_request_id, session_nullifier) VALUES (${job.id}, ${actor.id}, ${generation}, ${request.stage}, ${request.id}, ${verified.identifier})`;
    }
    await tx`UPDATE verification_requests SET status = 'consumed', consumed_at = now() WHERE id = ${request.id}`;
    return { verified: true, stage: request.stage, jobId: request.job_id };
  });
}

export async function merchantPickup(actor: Actor, id: string) {
  return db().begin(async (tx) => {
    const job = await lockJob(tx, id);
    merchantOwns(actor, job);
    requireCondition(
      job.state === "ASSIGNED" && job.assigned_courier_id,
      "INVALID_STATE",
      "An assigned courier must verify pickup first.",
    );
    const courier = await lockCourier(tx, job.assigned_courier_id);
    assertCourier(courier);
    const stages = await proofStages(tx, job);
    requireCondition(
      stages.includes("ACCEPT_JOB") && stages.includes("CONFIRM_PICKUP"),
      "MISSING_PROOF",
      "A fresh pickup proof from the assigned courier is required before handoff.",
    );
    const result = await confirmEscrowPickup(chainJob(job));
    await tx`UPDATE jobs SET state = 'PICKED_UP', updated_at = now() WHERE id = ${id}`;
    await event(tx, id, actor, "MERCHANT_HANDOFF_CONFIRMED", result.digest);
    return { state: "PICKED_UP" };
  });
}

export async function createRecipientLink(actor: Actor, id: string) {
  await rateLimit(actor.id, "recipient-link", 10);
  return db().begin(async (tx) => {
    const job = await lockJob(tx, id);
    merchantOwns(actor, job);
    requireCondition(
      job.state === "PICKED_UP",
      "INVALID_STATE",
      "Recipient confirmation becomes available after merchant handoff.",
    );
    await tx`UPDATE handoff_challenges SET consumed_at = now() WHERE job_id = ${id} AND consumed_at IS NULL`;
    const token = randomBytes(32).toString("base64url"),
      challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    await tx`INSERT INTO handoff_challenges (id, job_id, stage, token_hash, expires_at) VALUES (${challengeId}, ${id}, 'RECIPIENT', ${digestToken(token)}, ${expiresAt})`;
    await event(tx, id, actor, "RECIPIENT_LINK_CREATED");
    return {
      url: `${requiredEnv("APP_ORIGIN")}/recipient/${id}#token=${token}`,
      token,
      expiresAt,
    };
  });
}

export async function recipientAction(
  id: string,
  token: string,
  action: "confirm" | "dispute",
  reason?: string,
) {
  await rateLimit(digestToken(id), "recipient-attempt", 15);
  return db().begin(async (tx) => {
    const job = await lockJob(tx, id);
    const challenges =
      await tx`SELECT * FROM handoff_challenges WHERE job_id = ${id} AND token_hash = ${digestToken(token)} AND stage = 'RECIPIENT' FOR UPDATE`;
    const challenge = challenges[0];
    requireCondition(
      challenge &&
        !challenge.consumed_at &&
        new Date(challenge.expires_at).getTime() > Date.now(),
      "INVALID_CHALLENGE",
      "This recipient link is invalid, expired, or already used.",
      403,
    );
    const disputes =
      await tx`SELECT id FROM disputes WHERE job_id = ${id} AND status = 'open'`;
    assertDeliveryReady(job, await proofStages(tx, job), disputes.length > 0);
    if (action === "dispute") {
      requireCondition(
        reason && reason.length >= 5,
        "REASON_REQUIRED",
        "Describe the delivery problem.",
        400,
      );
      const sync = await synchronizeDispute(tx, job, null);
      if (sync.terminal) {
        await tx`UPDATE handoff_challenges SET consumed_at = now() WHERE id = ${challenge.id}`;
        return sync.terminal;
      }
      const disputeDigest = sync.digest;
      await tx`INSERT INTO disputes (id, job_id, reason) VALUES (${randomUUID()}, ${id}, ${reason})`;
      await tx`UPDATE jobs SET state = 'DISPUTED', updated_at = now() WHERE id = ${id}`;
      await event(
        tx,
        id,
        null,
        disputeDigest
          ? "RECIPIENT_DISPUTE_OPENED"
          : "RECIPIENT_DISPUTE_CHAIN_SYNC_PENDING",
        disputeDigest,
      );
      await tx`UPDATE handoff_challenges SET consumed_at = now() WHERE id = ${challenge.id}`;
      return {
        state: "DISPUTED",
        chainSyncPending: !disputeDigest,
        message: disputeDigest
          ? "Automatic payout is paused and the on-chain dispute lock is confirmed."
          : "Automatic payout is paused; the on-chain freeze is awaiting confirmation.",
      };
    } else {
      const courier = await lockCourier(tx, job.assigned_courier_id!);
      assertCourier(courier);
      const chain = await confirmEscrowDelivery(chainJob(job));
      await tx`UPDATE jobs SET state = 'DELIVERY_CONFIRMED', updated_at = now() WHERE id = ${id}`;
      await event(tx, id, null, "RECIPIENT_RECEIPT_CONFIRMED", chain.digest);
    }
    await tx`UPDATE handoff_challenges SET consumed_at = now() WHERE id = ${challenge.id}`;
    return { state: "DELIVERY_CONFIRMED" };
  });
}

export async function openDispute(actor: Actor, id: string, reason: string) {
  return db().begin(async (tx) => {
    const job = await lockJob(tx, id);
    involved(actor, job);
    requireCondition(
      ["ASSIGNED", "PICKED_UP", "DELIVERY_CONFIRMED", "PAYOUT_RETRY"].includes(
        job.state,
      ),
      "INVALID_STATE",
      "This delivery cannot enter a dispute at its current stage.",
    );
    const sync = await synchronizeDispute(tx, job, actor);
    if (sync.terminal) return sync.terminal;
    const disputeDigest = sync.digest;
    await tx`INSERT INTO disputes (id, job_id, reason) VALUES (${randomUUID()}, ${id}, ${reason})`;
    await tx`UPDATE jobs SET state = 'DISPUTED', updated_at = now() WHERE id = ${id}`;
    await tx`UPDATE settlements SET status = 'frozen', updated_at = now() WHERE job_id = ${id} AND status <> 'paid'`;
    await event(
      tx,
      id,
      actor,
      disputeDigest ? "DISPUTE_OPENED" : "DISPUTE_CHAIN_SYNC_PENDING",
      disputeDigest,
    );
    return {
      state: "DISPUTED",
      chainSyncPending: !disputeDigest,
      message: disputeDigest
        ? "Automatic payout is paused and the on-chain dispute lock is confirmed."
        : "Automatic payout is paused; the on-chain freeze is awaiting confirmation.",
    };
  });
}

export async function settleJob(actor: Actor, id: string) {
  return db().begin(async (tx) => {
    const job = await lockJob(tx, id);
    requireCondition(
      actor.role === "operator",
      "FORBIDDEN",
      "Only the settlement operator can release escrow.",
      403,
    );
    if (job.state === "PAID") {
      const settled =
        await tx`SELECT digest FROM settlements WHERE job_id = ${id} AND status = 'paid'`;
      return { state: "PAID", digest: settled[0]?.digest };
    }
    requireCondition(
      ["DELIVERY_CONFIRMED", "PAYOUT_RETRY"].includes(job.state) &&
        job.payout_address,
      "INVALID_STATE",
      "Receipt confirmation is required before settlement.",
    );
    const disputes =
      await tx`SELECT id FROM disputes WHERE job_id = ${id} AND status = 'open'`;
    requireCondition(
      disputes.length === 0,
      "DISPUTED",
      "A dispute freezes automatic payout.",
    );
    const stages = await proofStages(tx, job);
    requireCondition(
      stages.includes("ACCEPT_JOB") && stages.includes("CONFIRM_PICKUP"),
      "MISSING_PROOF",
      "Both current courier authorizations are required.",
    );
    const courier = await lockCourier(tx, job.assigned_courier_id!);
    assertCourier(courier);
    await tx`INSERT INTO settlements (job_id, payout_amount, wallet_address, status) VALUES (${id}, ${job.fee_usdc}, ${job.payout_address}, 'processing') ON CONFLICT (job_id) DO UPDATE SET status = 'processing', retry_count = settlements.retry_count + 1, updated_at = now()`;
    // The adapter reconciles the escrow before sending, so a crash after chain success never causes a blind second payout.
    try {
      const result = await settleEscrow({
        ...chainJob(job),
        payoutAddress: job.payout_address,
        amount: String(job.fee_usdc),
      });
      await tx`UPDATE settlements SET status = 'paid', digest = ${result.digest}, last_error = NULL, updated_at = now() WHERE job_id = ${id}`;
      await tx`UPDATE jobs SET state = 'PAID', updated_at = now() WHERE id = ${id}`;
      await event(tx, id, actor, "COURIER_PAID", result.digest);
      return {
        state: "PAID",
        digest: result.digest,
        reconciled: result.reconciled,
      };
    } catch (error) {
      // Keep the confirmed delivery and a durable retry marker. Never report paid on submission alone.
      await tx`UPDATE settlements SET status = 'retry', last_error = ${error instanceof ApiError ? error.code : "CHAIN_UNAVAILABLE"}, updated_at = now() WHERE job_id = ${id}`;
      await tx`UPDATE jobs SET state = 'PAYOUT_RETRY', updated_at = now() WHERE id = ${id}`;
      await event(tx, id, actor, "PAYOUT_RETRY_REQUIRED");
      return {
        state: "PAYOUT_RETRY",
        message:
          "Payout is not confirmed. The operator can safely retry after chain reconciliation.",
      };
    }
  });
}

export async function unassignJob(actor: Actor, id: string) {
  return db().begin(async (tx) => {
    const job = await lockJob(tx, id);
    requireCondition(
      job.state === "ASSIGNED" && job.assigned_courier_id === actor.id,
      "INVALID_STATE",
      "Only the assigned courier can cancel before merchant handoff.",
    );
    const result = await unassignEscrow(chainJob(job));
    await tx`UPDATE verification_requests SET status = 'cancelled' WHERE job_id = ${id} AND status = 'pending'`;
    await tx`UPDATE jobs SET state = 'FUNDED', assigned_courier_id = NULL, payout_address = NULL, updated_at = now() WHERE id = ${id}`;
    await event(tx, id, actor, "COURIER_UNASSIGNED", result.digest);
    return { state: "FUNDED" };
  });
}

export async function refundJob(actor: Actor, id: string) {
  return db().begin(async (tx) => {
    const job = await lockJob(tx, id);
    merchantOwns(actor, job);
    requireCondition(
      job.state === "FUNDED",
      "INVALID_STATE",
      "Only an unassigned funded delivery can be refunded automatically.",
    );
    const result = await refundEscrow(chainJob(job));
    await tx`UPDATE jobs SET state = 'REFUNDED', updated_at = now() WHERE id = ${id}`;
    await event(tx, id, actor, "MERCHANT_REFUNDED", result.digest);
    return { state: "REFUNDED", digest: result.digest };
  });
}

export async function attemptedDelivery(actor: Actor, id: string) {
  return db().begin(async (tx) => {
    const job = await lockJob(tx, id);
    requireCondition(
      job.state === "PICKED_UP" && job.assigned_courier_id === actor.id,
      "INVALID_STATE",
      "Only the assigned courier can report an attempt after pickup.",
    );
    await event(tx, id, actor, "DELIVERY_ATTEMPTED_RECIPIENT_UNAVAILABLE");
    return {
      state: "PICKED_UP",
      message:
        "Delivery attempt recorded. Recipient confirmation is still required; funds remain in escrow.",
    };
  });
}

export async function resolveDispute(
  actor: Actor,
  id: string,
  payCourier: boolean,
  resolution: string,
) {
  return db().begin(async (tx) => {
    const job = await lockJob(tx, id);
    requireCondition(
      actor.role === "operator" && job.state === "DISPUTED",
      "INVALID_STATE",
      "Only an operator can resolve an open delivery dispute.",
      403,
    );
    // The adapter first reconciles terminal outcomes, then synchronizes any missing freeze.
    let result: { digest: string };
    try {
      result = await resolveEscrowDispute({ ...chainJob(job), payCourier });
    } catch (error) {
      if (!(error instanceof SuiAlreadySettledError)) throw error;
      const actual = await recordTerminal(tx, job, actor, error.terminal);
      await tx`UPDATE disputes SET status = 'resolved', resolution = ${`Chain already ${error.terminal.state}. Operator review: ${resolution}`}, resolver = ${actor.id}, resolved_at = now() WHERE job_id = ${id} AND status = 'open'`;
      return actual;
    }
    await tx`UPDATE disputes SET status = 'resolved', resolution = ${resolution}, resolver = ${actor.id}, resolved_at = now() WHERE job_id = ${id} AND status = 'open'`;
    if (payCourier) {
      requireCondition(
        job.payout_address,
        "MISSING_WALLET",
        "No courier payout address is recorded.",
      );
      await tx`INSERT INTO settlements (job_id, payout_amount, wallet_address, digest, status) VALUES (${id}, ${job.fee_usdc}, ${job.payout_address}, ${result.digest}, 'paid') ON CONFLICT (job_id) DO UPDATE SET status = 'paid', digest = ${result.digest}, updated_at = now()`;
    }
    await tx`UPDATE jobs SET state = 'RESOLVED', updated_at = now() WHERE id = ${id}`;
    await event(
      tx,
      id,
      actor,
      payCourier
        ? "DISPUTE_RESOLVED_COURIER_PAID"
        : "DISPUTE_RESOLVED_MERCHANT_REFUNDED",
      result.digest,
    );
    return {
      state: "RESOLVED",
      outcome: payCourier ? "courier_paid" : "merchant_refunded",
      digest: result.digest,
    };
  });
}

export async function createWalletChallenge(
  actor: Actor,
  walletAddress: string,
) {
  await rateLimit(actor.id, "wallet-challenge", 10);
  const id = randomUUID(),
    expiresAt = new Date(Date.now() + 5 * 60_000);
  const address = `0x${walletAddress.slice(2).padStart(64, "0").toLowerCase()}`;
  const message = `Haulie wallet binding\nOrigin: ${requiredEnv("APP_ORIGIN")}\nAccount: ${actor.id}\nWallet: ${address}\nChallenge: ${id}\nNonce: ${randomBytes(32).toString("hex")}\nExpires: ${expiresAt.toISOString()}`;
  await db()`INSERT INTO wallet_challenges (id, courier_id, wallet_address, message, expires_at) VALUES (${id}, ${actor.id}, ${address}, ${message}, ${expiresAt})`;
  return { challengeId: id, message, expiresAt };
}

export async function bindWallet(
  actor: Actor,
  challengeId: string,
  signature: string,
) {
  await rateLimit(actor.id, "wallet-bind", 10);
  return db().begin(async (tx) => {
    // Courier lock serializes concurrent bindings; job acceptance takes job then courier and snapshots this value.
    const courier = await lockCourier(tx, actor.id);
    assertCourier(courier, false);
    const activeJobs =
      await tx`SELECT id FROM jobs WHERE assigned_courier_id = ${actor.id} AND state IN ('ASSIGNED','PICKED_UP','DELIVERY_CONFIRMED','PAYOUT_RETRY','DISPUTED')`;
    requireCondition(
      activeJobs.length === 0,
      "ACTIVE_DELIVERY",
      "Wallet changes require operator recovery while a delivery is active.",
    );
    const rows =
      await tx`SELECT * FROM wallet_challenges WHERE id = ${challengeId} AND courier_id = ${actor.id} FOR UPDATE`;
    const challenge = rows[0];
    requireCondition(
      challenge &&
        !challenge.consumed_at &&
        new Date(challenge.expires_at).getTime() > Date.now(),
      "INVALID_CHALLENGE",
      "The wallet challenge is invalid or expired.",
      403,
    );
    try {
      await verifyPersonalMessageSignature(
        new TextEncoder().encode(challenge.message),
        signature,
        { address: challenge.wallet_address },
      );
    } catch {
      throw new ApiError(
        403,
        "INVALID_SIGNATURE",
        "The wallet signature does not match this challenge and address.",
      );
    }
    await tx`UPDATE couriers SET wallet_address = ${challenge.wallet_address}, wallet_bound_at = now() WHERE id = ${actor.id}`;
    await tx`UPDATE wallet_challenges SET consumed_at = now() WHERE id = ${challengeId}`;
    return { walletAddress: challenge.wallet_address, bound: true };
  });
}
