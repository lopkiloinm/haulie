import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCourier, assertDeliveryReady, assertJobStage, assertProofRequest, proofIdentifier, type Courier, type Job, type VerificationRequest } from "../../src/lib/server/domain";
import { ApiError } from "../../src/lib/server/errors";
import { validateWorldContext } from "../../src/lib/server/world";
import { secureEqual, sessionSignature } from "../../src/lib/server/auth";

const courier: Courier = { id: "courier-a", account_status: "active", world_session_id: "session_a", unique_human_verified_at: new Date(), wallet_address: "0x123", wallet_bound_at: new Date(), service_area: "London", vehicle_type: "bicycle", contact_method: "Pilot contact", rules_accepted_at: new Date() };
const job: Job = { id: "job-a", merchant_id: "merchant-a", fee_usdc: "6000000", state: "FUNDED", assigned_courier_id: null, payout_address: null, escrow_object_id: "0xabc", delivery_deadline: new Date(Date.now() + 3600_000) };
const request: VerificationRequest = { id: "request-a", courier_id: courier.id, job_id: job.id, stage: "ACCEPT_JOB", nonce: "nonce-a", status: "pending", expires_at: new Date(Date.now() + 60_000), expected_session_id: "session_a", environment: "staging", action: null, rp_context: {} };
const proof = { protocol_version: "4.0", nonce: "nonce-a", environment: "staging", session_id: "session_a", responses: [{ identifier: "proof_of_human", issuer_schema_id: 1, proof: ["0xab"], session_nullifier: ["0x1", "0x2"] }] };
const rejects = (run: () => unknown, code: string) => assert.throws(run, error => error instanceof ApiError && error.code === code);

test("unfunded deliveries cannot be accepted", () => {
  rejects(() => assertJobStage({ ...job, state: "DRAFT" }, "ACCEPT_JOB", courier.id), "JOB_UNAVAILABLE");
  assertJobStage(job, "ACCEPT_JOB", courier.id);
});
test("a second courier cannot accept an assigned job", () => {
  rejects(() => assertJobStage({ ...job, state: "ASSIGNED", assigned_courier_id: "another" }, "ACCEPT_JOB", courier.id), "JOB_UNAVAILABLE");
});
test("pickup belongs exclusively to the assigned courier", () => {
  rejects(() => assertJobStage({ ...job, state: "ASSIGNED", assigned_courier_id: "another" }, "CONFIRM_PICKUP", courier.id), "PICKUP_FORBIDDEN");
});
test("proof authorizations reject wrong jobs, accounts, and stages", () => {
  rejects(() => assertProofRequest(request, courier.id, "job-b", "ACCEPT_JOB"), "WRONG_CONTEXT");
  rejects(() => assertProofRequest(request, "courier-b", job.id, "ACCEPT_JOB"), "WRONG_CONTEXT");
  rejects(() => assertProofRequest(request, courier.id, job.id, "CONFIRM_PICKUP"), "WRONG_CONTEXT");
});
test("expired and already consumed requests never authorize transitions", () => {
  rejects(() => assertProofRequest({ ...request, expires_at: new Date(0) }, courier.id, job.id, "ACCEPT_JOB"), "PROOF_EXPIRED");
  rejects(() => assertProofRequest({ ...request, status: "consumed" }, courier.id, job.id, "ACCEPT_JOB"), "PROOF_REPLAY");
});
test("suspended, revoked and unenrolled couriers cannot proceed", () => {
  for (const status of ["suspended", "revoked"]) rejects(() => assertCourier({ ...courier, account_status: status }), "COURIER_INACTIVE");
  rejects(() => assertCourier({ ...courier, world_session_id: null }), "ONBOARDING_REQUIRED");
  rejects(() => assertCourier({ ...courier, rules_accepted_at: null }), "PROFILE_REQUIRED");
});
test("recipient confirmation requires both proofs and merchant custody handoff", () => {
  const pickedUp = { ...job, state: "PICKED_UP" as const, assigned_courier_id: courier.id, payout_address: "0x123" };
  rejects(() => assertDeliveryReady(job, ["ACCEPT_JOB", "CONFIRM_PICKUP"], false), "DELIVERY_NOT_READY");
  rejects(() => assertDeliveryReady(pickedUp, ["ACCEPT_JOB"], false), "MISSING_PROOF");
  rejects(() => assertDeliveryReady(pickedUp, ["ACCEPT_JOB", "CONFIRM_PICKUP"], true), "DISPUTED");
  assertDeliveryReady(pickedUp, ["ACCEPT_JOB", "CONFIRM_PICKUP"], false);
});
test("nullifier canonicalization prevents hex case and leading-zero replay bypasses", () => {
  assert.equal(proofIdentifier("session", ["0x00AB", "0x0002"]), proofIdentifier("session", ["0xab", "0x2"]));
  assert.notEqual(proofIdentifier("session", ["0xab", "0x2"]), proofIdentifier("session", ["0xab", "0x3"]));
  assert.notEqual(proofIdentifier("uniqueness", "0xab"), proofIdentifier("session", ["0xab", "0x2"]));
});
test("World proof nonce, environment and enrolled session are bound to request", () => {
  validateWorldContext(proof, request);
  rejects(() => validateWorldContext({ ...proof, nonce: "old-nonce" }, request), "WRONG_CONTEXT");
  rejects(() => validateWorldContext({ ...proof, environment: "production" }, request), "WRONG_CONTEXT");
  rejects(() => validateWorldContext({ ...proof, session_id: "session_b" }, request), "WRONG_SESSION");
});
test("session requests reject an enrollment action and uniqueness responses", () => {
  rejects(() => validateWorldContext({ ...proof, action: "enrollment" }, request), "WRONG_PROOF_TYPE");
  rejects(() => validateWorldContext({ ...proof, responses: [{ ...proof.responses[0], session_nullifier: undefined, nullifier: "0xa" }] }, request), "WRONG_PROOF_TYPE");
  assert.throws(() => validateWorldContext({ ...proof, protocol_version: "3.0" }, request));
});
test("proof of human credential is enforced, not arbitrary successful credentials", () => {
  assert.throws(() => validateWorldContext({ ...proof, responses: [{ ...proof.responses[0], identifier: "unrequested", issuer_schema_id: 99 }] }, request));
});
test("signed application sessions change when claims or signing key change", () => {
  const signature = sessionSignature("courier-a", "a".repeat(32));
  assert.ok(secureEqual(signature, sessionSignature("courier-a", "a".repeat(32))));
  assert.ok(!secureEqual(signature, sessionSignature("courier-b", "a".repeat(32))));
  assert.ok(!secureEqual(signature, sessionSignature("courier-a", "b".repeat(32))));
  assert.ok(!secureEqual(signature, "wrong"));
});
