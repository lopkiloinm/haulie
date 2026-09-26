# Haulie — revised product and build spec

**Haulie is a last-mile delivery marketplace where the courier proves control of their World ID for every delivery, the merchant funds the job before it is offered, and a confirmed handoff releases the courier’s USDC payout on Sui.** The defining product moment is a delivery that cannot be accepted—or picked up—using an old verification badge.

**Tagline:** *A verified human at every handoff. Payment ready at delivery.*

This revision makes World ID an active, per-delivery security requirement. It does not claim that proof of humanity establishes legal identity, good intentions, or physical possession of a parcel. Haulie combines repeated World ID checks with merchant and recipient handoff confirmations to address those different risks. World ID 4.0 distinguishes one-time uniqueness proofs from session proofs for returning-user continuity; the latter are the appropriate basis for repeated delivery checks. [docs.world](https://docs.world.org/world-id/4-0-migration)

## Product and user journeys

### The problem

A small retailer can arrange a local delivery, but three questions remain difficult to answer quickly:

- Is the courier accepting this particular job the verified person associated with the account?
- Did the parcel actually change hands at pickup and drop-off?
- Is the courier’s fee already available, and what exactly triggers payment?

Haulie presents those answers on one delivery timeline: **funded → courier re-verified → picked up with re-verification → recipient confirmed → paid**. Each stage records who authorized it, when it happened, and whether the next stage is permitted.

### Users

| Role | Main actions | Must use World ID? |
|---|---|---|
| Merchant | Create and fund a job; confirm pickup; monitor delivery; dispute an issue | No for the MVP; authenticated business account |
| Courier | Enroll, bind payout wallet, verify for each job, collect and deliver parcel | **Yes, at enrollment and for every delivery** |
| Recipient | Confirm receipt or report a problem through a limited-purpose link | No for the MVP |
| Operator | Review exceptions and disputes; audit settlement | No; separately secured staff account |

Do not call couriers “background checked” or “ID verified” solely because they have World ID. Label their status **“Unique-human verified”** and show a separate **“Verified for this delivery”** status after the fresh check. World ID describes its product as privacy-preserving proof that a user is a unique human, not disclosure of personal identity. [docs.world](https://docs.world.org/world-id/overview)

### Courier onboarding

1. Create a Haulie account and explain what World ID will and will not establish.
2. Complete a World ID 4.0 one-time uniqueness proof.
3. Create a World ID session and associate its verified `session_id` with the Haulie courier account.
4. Connect a Sui wallet and sign a fresh wallet-binding challenge. Store the verified wallet address as the default payout address.
5. Complete operational fields appropriate to the pilot—service area, vehicle type, contact method, and acceptance of delivery rules.

Keep the one-time uniqueness proof’s nullifier for replay prevention. **Do not use that nullifier as the courier’s persistent identity or reuse the enrollment proof to authorize later jobs.** World’s 4.0 guidance uses `session_id` for continuity and `session_nullifier` for per-proof replay protection. [docs.world](https://docs.world.org/world-id/4-0-migration)

### Per-delivery journey

1. **Merchant creates and funds the job.** The fee, parcel category, pickup and destination areas, delivery window, and cancellation rules are shown before funding. The job does not enter the courier feed until its Sui escrow funding is confirmed.
2. **Courier selects “Accept.”** Haulie creates a short-lived, server-associated World ID session-proof request for that courier and job. The courier approves the proof. Backend verification must confirm the expected `session_id`, request context, environment, expiry, and unused `session_nullifier` before acceptance succeeds.
3. **Courier arrives at pickup.** A second, fresh session proof is required. It must match the same enrolled `session_id` and this job’s pickup request. Only then does the merchant get the “Hand over parcel” confirmation. Both confirmations are necessary to move custody to the courier.
4. **Courier arrives at drop-off.** The recipient confirms receipt with a job-specific, expiring challenge. Haulie checks the assigned courier, acceptance proof, pickup proof, and absence of a dispute.
5. **Payout executes.** The authorized settlement call releases the specified USDC amount to the payout address snapshotted when the courier accepted the job. The app shows **“Payout processing”** until the Sui transaction succeeds, then **“Paid”** with its transaction digest.

World’s integration flow calls for backend-signed request context and backend verification of the returned proof through its v4 verification endpoint. Haulie must additionally enforce its own job-stage authorization and replay checks; a valid World proof is not, on its own, permission to accept any job. [docs.world](https://docs.world.org/world-id/4-0-migration)

### Failure and dispute journeys

| Event | Required behavior |
|---|---|
| No fresh World proof at acceptance | Do not assign the job |
| Proof belongs to a different enrolled session | Reject and flag the attempt |
| Valid proof presented for the wrong job or stage | Reject; no custody transition |
| Previously used proof presented again | Reject via stored replay-protection value |
| Pickup re-verification fails | Merchant must not hand over the parcel through Haulie; job remains unresolved |
| Courier cancels before pickup | Release assignment under policy; make the still-funded job available again or refund the merchant |
| Recipient is unavailable | Mark attempted delivery; do not settle as delivered |
| Recipient reports damage or nonreceipt | Freeze automatic payout and open a case |
| Settlement call fails | Retain the confirmed state, retry idempotently, and never display “Paid” prematurely |
| Courier loses access to World ID or wallet mid-job | Pause automatic progress and invoke a documented operator recovery path; do not silently swap identities or payout addresses |

## Architecture and security rules

### Stack

| Component | Choice | Purpose |
|---|---|---|
| App | Next.js, TypeScript, mobile-first PWA | Merchant, courier, recipient, and operator interfaces in one deploy |
| API | TypeScript server with authenticated route handlers | World ID verification, job rules, handoff validation, settlement orchestration |
| Database | PostgreSQL | Durable job state, uniqueness constraints, proof-use records, event log |
| Realtime | Server-sent events or equivalent | Live custody and payment timeline |
| Identity | World ID IDKit 4.x | One-time enrollment plus fresh session proofs |
| Payments | Sui Move escrow and native USDC | Pre-funded, job-specific courier payout |
| Wallet UX | Sui wallet connection; optional sponsored transactions | Payout address and lower-friction actions |
| Naming | Optional SuiNS | Human-readable `.sui` payout display |

Use **SuiNS rather than ENS for the MVP**. The product pays to Sui addresses, and SuiNS resolves `.sui` names to those addresses. ENS could later appear as an optional profile alias, but it should not be placed on the critical verification or payout path. Native USDC is available on Sui; use the documented coin type for the selected network, particularly when switching between testnet and mainnet. [docs.sui](https://docs.sui.io/sui-stack/suins/sui-stack-suins)

### Verification protocol

Model each required check as a **delivery authorization**, not a reusable `verified=true` flag:

```text
Enrollment uniqueness proof
    → verified courier account + stored session_id
    → fresh ACCEPT_JOB session proof for job A
    → fresh CONFIRM_PICKUP session proof for job A
    → recipient confirms drop-off for job A
```

For every proof request:

- Generate the request on the backend and associate its request ID with `courier_id`, `job_id`, `stage`, expiry, and a fresh nonce.
- Have the client obtain a World ID proof using that request context.
- Verify the returned payload server-side with World’s v4 endpoint; do not trust a client-reported success.
- Check that the verified `session_id` equals the enrolled account’s `session_id`.
- Enforce the expected request, job, stage, authenticated session, and time window in Haulie’s own database.
- Store and uniquely constrain the per-proof `session_nullifier` so it cannot authorize a second transition.
- Consume the authorization in the same database transaction that changes the job state.
- Reject a courier whose session has been revoked or whose account is suspended.

World ID’s migration documentation specifically recommends session proofs for recurring verifications and warns that repeatedly checking the same uniqueness action is an anti-pattern. It identifies `session_id` as the returning-user link and `session_nullifier` as per-proof replay protection. [docs.world](https://docs.world.org/world-id/4-0-migration)

**Important assurance boundary:** A fresh session proof demonstrates control of the same World ID session used by the enrolled account at that point in the workflow. It cannot establish that the courier is physically at an address or that the parcel is intact. For a stronger future version, evaluate a supported fresh credential or selfie-check flow, merchant-present challenge, and operational screening as *additional* controls—not as properties implied by a session proof. World’s documented verification flows distinguish proof consent from credential enrollment and selfie-check behavior. [docs.world](https://docs.world.org/world-id/idkit/verification-flows)

### Job and escrow state machine

```text
DRAFT
  ↓ merchant funds escrow
FUNDED
  ↓ fresh courier proof + exclusive assignment
ASSIGNED
  ↓ fresh courier pickup proof + merchant confirms handoff
PICKED_UP
  ↓ recipient confirms receipt
DELIVERY_CONFIRMED
  ↓ authorized Sui settlement succeeds
PAID
```

Alternative paths: `FUNDED → CANCELLED/REFUNDED`; `ASSIGNED → FUNDED` after valid pre-pickup unassignment; `PICKED_UP → DISPUTED → RESOLVED`; and `DELIVERY_CONFIRMED → PAYOUT_RETRY` if the settlement transaction fails.

The Move package should hold a per-job USDC balance and enforce the funding amount, assigned payout address, legal state transitions, dispute lock, and exactly-once release or refund. Emit events for funding, assignment, dispute, refund, and payment. Put only a non-sensitive job reference on-chain—**never** parcel addresses, phone numbers, photos, routes, World session identifiers, or proof nullifiers.

For the hackathon, the backend can attest to the Move contract that the required World proofs and off-chain handoffs passed. Be explicit that this makes Haulie **operator-attested delivery with on-chain escrow**, not cryptographic proof of a physical delivery. Sui supports programmable transaction blocks for composing calls and transfers, and sponsored transactions can cover user gas; if used, the sponsor should approve only expected transaction shapes and capped gas budgets. [docs.sui](https://docs.sui.io/develop)

### Minimum data model

- `couriers`: `id`, `account_status`, `world_session_id`, `wallet_address`, `wallet_bound_at`, `created_at`.
- `used_world_proofs`: `proof_identifier`, `courier_id`, `proof_type`, `verified_at`; unique proof identifier. Store only what verification and audit require.
- `jobs`: `id`, merchant ID, private addresses, fee in USDC base units, current state, assigned courier, payout-address snapshot, escrow object ID, deadlines.
- `verification_requests`: `id`, `job_id`, `courier_id`, `stage`, nonce/reference, expiry, status.
- `delivery_verifications`: `job_id`, `courier_id`, `stage`, verification request ID, `session_nullifier`, verified time; unique replay-protection value.
- `handoff_challenges`: `job_id`, stage, hashed challenge, expiry, consumed time.
- `job_events`: append-only timeline containing actor, event type, timestamp, and any Sui transaction digest.
- `settlements`: job ID, payout amount, wallet, digest, status, retry count; enforce one successful payout per job.
- `disputes`: job ID, reason, restricted evidence references, status, resolution, resolver.

Indexes and transactions must enforce **one assigned courier per job**, **one consumed proof per required stage**, and **one completed payout per job**. Reconcile chain events back into the database after crashes rather than trying a blind second payment.

### Privacy and operational safeguards

World verification should stay off-chain. Store limited proof metadata, protect session identifiers as account-linked data, restrict evidence by role, and set retention and deletion rules for addresses and photos. Recipient links should be short-lived, single-purpose, and token-hashed in storage. Rate-limit proof requests and handoff attempts. Do not imply that World ID replaces legal identity checks, insurance, screening, or a lost-parcel process. [docs.world](https://docs.world.org/world-id/4-0-migration)

A production launch also needs explicit parcel restrictions, liability and insurance terms, courier onboarding policy, location-data handling, refunds, taxes, and local legal review. Those are launch requirements, not features to pretend a 48-hour prototype has completed.

## Hackathon execution plan

### Prioritize the differentiator

**Non-negotiable demo path:** real World ID staging proofs for enrollment and per-delivery checks; a real funded Sui testnet escrow; merchant pickup confirmation; recipient receipt confirmation; and an actual testnet USDC payout. World’s docs distinguish staging from production, so label staging clearly in the UI and submission. [docs.world](https://docs.world.org/world-id/idkit/integrate)

| Phase | Build | Definition of done |
|---|---|---|
| 0–6 hours | Lock user flow, state machine, UI storyboard, and test accounts | Team can rehearse the complete delivery without unspecified transitions |
| 6–16 hours | Move escrow, funding, release/refund tests, testnet deployment | A funded job pays once and refuses a second release |
| 10–22 hours | World ID enrollment and fresh session-proof verification | Same courier can prove continuity twice; replay and wrong-session proofs fail |
| 18–30 hours | Merchant job creation, courier assignment, mobile screens | Unfunded or unverified jobs cannot advance |
| 28–39 hours | Pickup challenge, recipient confirmation, settlement worker, realtime UI | End-to-end delivery produces a visible payout digest |
| 39–45 hours | Negative-path testing and polish | Wrong job, expired request, missing pickup proof, and dispute block correctly |
| 45–48 hours | Recorded backup, README, architecture slide, pitch rehearsal | Judge can inspect the transaction and understand the trust boundary |

If time runs short, cut automated matching, rich maps, courier ratings, photo analysis, ENS, and even SuiNS display **before** cutting either of the two fresh per-delivery World proofs.

### Three-minute live demo

1. **Show the offer:** A merchant posts a local delivery with a 6 USDC courier fee. The job displays a real Sui testnet escrow as “funds reserved.”
2. **Show the first gate:** A courier taps “Accept.” Haulie refuses to proceed without a fresh World ID proof. After approval, the job becomes assigned.
3. **Show the second gate:** At pickup, the merchant sees “Courier verification required.” The courier proves control of the same World ID session again; the merchant confirms handing over the parcel.
4. **Show delivery and payment:** The recipient confirms receipt. The custody baton moves to the recipient, the escrow releases, and the courier sees 6 USDC paid with a transaction digest.
5. **Show resistance to abuse:** Replay the acceptance proof or try pickup using a different courier account. Haulie rejects it.

Use a split-screen merchant/courier/recipient view with the parcel as a single animated card. Place the **fresh verification gates** and the **locked-to-released payment** on the same timeline. That is the memorable, technically defensible story: not that bad actors disappear, but that an old badge cannot authorize a new delivery, physical handoffs need independent confirmation, and a funded courier fee pays under explicit rules.