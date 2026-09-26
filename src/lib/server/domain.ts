import { createHash } from "node:crypto";
import { requireCondition } from "./errors";

export type JobState =
  | "DRAFT"
  | "FUNDED"
  | "ASSIGNED"
  | "PICKED_UP"
  | "DELIVERY_CONFIRMED"
  | "PAYOUT_RETRY"
  | "PAID"
  | "DISPUTED"
  | "RESOLVED"
  | "REFUNDED";
export type Stage =
  "ENROLL_UNIQUENESS" | "ENROLL_SESSION" | "ACCEPT_JOB" | "CONFIRM_PICKUP";
export interface Job {
  id: string;
  merchant_id: string;
  fee_usdc: string;
  state: JobState;
  assigned_courier_id: string | null;
  payout_address: string | null;
  escrow_object_id: string | null;
  delivery_deadline: Date;
}
export interface Courier {
  id: string;
  account_status: string;
  world_session_id: string | null;
  unique_human_verified_at: Date | null;
  wallet_address: string | null;
  wallet_bound_at: Date | null;
  service_area?: string | null;
  vehicle_type?: string | null;
  contact_method?: string | null;
  rules_accepted_at?: Date | null;
}
export interface VerificationRequest {
  id: string;
  courier_id: string;
  job_id: string | null;
  stage: Stage;
  nonce: string;
  status: string;
  expires_at: Date;
  expected_session_id: string | null;
  environment: string;
  action: string | null;
  rp_context: Record<string, unknown>;
}

export const digestToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function assertCourier(courier: Courier, enrolled = true) {
  requireCondition(
    courier.account_status === "active",
    "COURIER_INACTIVE",
    "This courier account is suspended or revoked.",
    403,
  );
  if (enrolled)
    requireCondition(
      courier.world_session_id &&
        courier.unique_human_verified_at &&
        courier.wallet_address &&
        courier.wallet_bound_at,
      "ONBOARDING_REQUIRED",
      "Complete unique-human verification, session enrollment, and wallet binding first.",
      403,
    );
  if (enrolled)
    requireCondition(
      courier.service_area &&
        courier.vehicle_type &&
        courier.contact_method &&
        courier.rules_accepted_at,
      "PROFILE_REQUIRED",
      "Complete the courier operational profile and accept delivery rules first.",
      403,
    );
}

export function assertProofRequest(
  request: VerificationRequest,
  courierId: string,
  jobId: string | null,
  stage: Stage,
  now = new Date(),
) {
  requireCondition(
    request.courier_id === courierId &&
      request.job_id === jobId &&
      request.stage === stage,
    "WRONG_CONTEXT",
    "This proof request belongs to a different account, job, or stage.",
    403,
  );
  requireCondition(
    request.status === "pending",
    "PROOF_REPLAY",
    "This verification request has already been consumed.",
  );
  requireCondition(
    request.expires_at.getTime() > now.getTime(),
    "PROOF_EXPIRED",
    "This verification request has expired.",
  );
}

export function assertJobStage(job: Job, stage: Stage, courierId: string) {
  if (stage === "ACCEPT_JOB") {
    requireCondition(
      job.state === "FUNDED" && !job.assigned_courier_id,
      "JOB_UNAVAILABLE",
      "Only a funded, unassigned delivery can be accepted.",
    );
    requireCondition(
      job.delivery_deadline.getTime() > Date.now(),
      "JOB_EXPIRED",
      "The delivery window has expired.",
    );
  } else if (stage === "CONFIRM_PICKUP") {
    requireCondition(
      job.state === "ASSIGNED" && job.assigned_courier_id === courierId,
      "PICKUP_FORBIDDEN",
      "Only the assigned courier can verify pickup.",
      403,
    );
  }
}

export function assertDeliveryReady(
  job: Job,
  proofStages: string[],
  hasOpenDispute: boolean,
) {
  requireCondition(
    job.state === "PICKED_UP" && job.assigned_courier_id && job.payout_address,
    "DELIVERY_NOT_READY",
    "Merchant pickup confirmation is required before receipt.",
  );
  requireCondition(
    proofStages.includes("ACCEPT_JOB") &&
      proofStages.includes("CONFIRM_PICKUP"),
    "MISSING_PROOF",
    "Both fresh courier authorizations are required.",
  );
  requireCondition(
    !hasOpenDispute,
    "DISPUTED",
    "An open dispute blocks delivery confirmation.",
  );
}

export function proofIdentifier(
  kind: "session" | "uniqueness",
  value: string | [string, string],
) {
  const normalize = (part: string) => {
    requireCondition(
      /^0x[0-9a-f]+$/i.test(part),
      "INVALID_PROOF",
      "The proof replay identifier is malformed.",
      400,
    );
    return `0x${BigInt(part).toString(16)}`;
  };
  const canonical = Array.isArray(value)
    ? value.map(normalize)
    : normalize(value);
  return digestToken(`${kind}:${JSON.stringify(canonical)}`);
}
