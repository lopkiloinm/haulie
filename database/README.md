# Haulie live backend

The deployed responsive interface is a clearly labeled interactive demo. Live APIs are a separate, fail-closed pilot backend: database records, World ID proofs, and Sui escrow receipts are never synthesized when credentials are missing. The demo does not enroll real couriers or move funds. A complete live pilot requires the configuration below and a client connected to these endpoints; configuration presence alone does not establish that the full flow has been exercised.

## Database and account setup

1. Provision PostgreSQL with TLS (for example a Vercel-connected Neon database). Use a pooled connection string in `DATABASE_URL`. Apply `database/001_initial.sql` once with your migration/admin identity: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/001_initial.sql`.
2. Set the values in `.env.backend.example` and `.env.sui.example` in Vercel. `APP_ORIGIN` must be the exact HTTPS origin used for this deployment. Preview deployments should have separate staging infrastructure and an origin matching that preview deployment.
3. Generate a random session key with `openssl rand -hex 32`. Keep it server-only. Use a separate database application role that can select/insert/update the application tables and use their sequences, but cannot alter tables, disable audit triggers, or read unrelated schemas. Migration credentials must not be used by the deployed application.
4. Provision pilot accounts with the admin script. Examples: `node --env-file=.env.local database/provision-account.mjs --role=courier --name="Pilot Courier"`; use `--role=operator` for separately secured staff; use `--role=merchant --wallet=0x...` only after independently verifying the merchant controls that wallet. Deliver each generated account ID and high-entropy access token securely to its intended owner. No default or public accounts exist.
5. Sign in with `POST /api/auth/session`, JSON `{ "accountId": "uuid", "accessToken": "generated credential" }`. The server sets an eight-hour signed `__Host-haulie-session` cookie with HttpOnly, Secure, and SameSite=Strict. Roles, suspension, and session version are loaded from the database on each request. No request header can choose a user or role. Every POST requires an `Origin` exactly matching `APP_ORIGIN`; browser fetch sends it automatically. For local HTTPS development, set `APP_ORIGIN` accordingly.

This is a provisioned, closed pilot authentication scheme. Production public registration, account recovery, and staff MFA should use a properly integrated identity provider before public onboarding. Account credentials are stored as SHA-256 hashes of generated 256-bit random tokens, never as plain text. To revoke active login cookies, increment `accounts.session_version`; to suspend login, set `accounts.status = 'suspended'`. Rotate and redistribute the account token hash out of band if a credential is lost.

## Courier enrollment and delivery checks

Use IDKit 4.x in the client. The backend requests the v4 `proof_of_human` credential, issuer schema 1, and rejects legacy v3 proofs. Sessions demonstrate continuity with an enrolled World ID, not legal identity or parcel possession.

1. Save operational fields through `POST /api/courier/profile`: `serviceArea`, `vehicleType` (`bicycle`, `cargo_bicycle`, `scooter`, `car`, or `van`), `contactMethod`, and `acceptsDeliveryRules: true`.
2. `POST /api/world/requests` with `{ "stage": "ENROLL_UNIQUENESS" }`. Pass the returned app ID, action, environment, and `rp_context` to `IDKit.request(...).preset(proofOfHuman())`. Do not request legacy proofs. Send the unchanged IDKit result to `/api/world/verify` as `{ "requestId": "...", "proof": result }`.
3. Request `ENROLL_SESSION`, call `IDKit.createSession(...).preset(proofOfHuman())`, and send the result to the same verification endpoint. The backend stores the verified `session_id` once. Replacing it requires an operator recovery procedure.
4. `POST /api/wallet/challenge` with `{ "walletAddress": "0x..." }`; have that Sui wallet sign the exact returned message with `signPersonalMessage`. Submit `{ "challengeId": "...", "signature": "..." }` to `/api/wallet/bind`. Challenges bind origin, account, wallet, expiry and nonce. Wallets cannot change during an active delivery.
5. For `ACCEPT_JOB` and `CONFIRM_PICKUP`, include `jobId` in `/api/world/requests`. Use `IDKit.proveSession(existing_session_id, ...).preset(proofOfHuman())`; session requests have no `action`. Submit the unchanged result. The backend checks the nonce, environment, expected session, current account status, job, stage, deadline, and unique replay identifier before consuming the request in the same database transaction as the authorized transition.

Every verification calls the official World v4 backend endpoint. A client-provided `success` field grants nothing. Proof bodies are not persisted or logged. Only request context, the account-linked session ID, and a canonical hashed replay identifier are kept. No World identifiers are written on-chain.

Official references: [World ID 4.0 migration](https://docs.world.org/world-id/4-0-migration), [session proofs](https://docs.world.org/world-id/idkit/session-proofs), [backend verification endpoint](https://docs.world.org/api-reference/developer-portal/verify).

## API workflow

All authenticated POSTs accept JSON; send `{}` for actions without input. Errors use `{ error, message }` and an appropriate HTTP status. All USDC amounts are integer base-unit strings (6 USDC is `"6000000"`). A successful transaction submission is never enough to mark a job paid.

| Endpoint | Authorization and effect |
| --- | --- |
| `GET /api/health` | Public syntactic configuration status; does not imply real transactions or connected services |
| `GET /api/jobs` | Merchant's jobs, assigned courier's jobs plus funded offers, or operator overview |
| `POST /api/jobs` | Merchant creates draft with `parcelCategory`, `pickupArea`, `destinationArea`, private `pickupAddress`, private `destinationAddress`, `feeUsdc`, ISO `deliveryDeadline`, `cancellationRules` |
| `GET /api/jobs/:id` | Participants and operators only; detailed delivery and audit timeline |
| `GET /api/jobs/:id/events` | Authenticated SSE with `Last-Event-ID`; reconnects every five seconds for Vercel serverless compatibility |
| `POST /api/jobs/:id/prepare-funding` | Merchant receives unsigned serialized Sui funding transaction; wallet must sign and execute it |
| `POST /api/jobs/:id/fund` | Merchant submits `escrowId` and `digest`; backend verifies chain, contract, USDC, sender, amount, job reference and confirmed funding |
| `POST /api/jobs/:id/pickup` | Owning merchant confirms handoff only after the assigned courier's second fresh proof |
| `POST /api/jobs/:id/recipient-link` | Owning merchant receives a one-hour, single-purpose recipient token after pickup; deliver it through an authorized channel |
| `POST /api/recipient/:id` | Recipient token, `action: "confirm"` or `"dispute"`; dispute requires `reason`; consumes token transactionally |
| `POST /api/jobs/:id/attempt` | Assigned courier records recipient-unavailable attempt; no custody completion or payment |
| `POST /api/jobs/:id/unassign` | Assigned courier cancels before merchant handoff; still-funded job becomes available, old pending requests are cancelled |
| `POST /api/jobs/:id/refund` | Owning merchant refunds an unassigned funded job |
| `POST /api/jobs/:id/dispute` | A participant/operator opens a case with `reason`, immediately freezing automatic payout in the database even if Sui is unavailable |
| `POST /api/jobs/:id/settle` | Separately authenticated operator confirms or retries payout; checks chain state before sending |
| `POST /api/jobs/:id/resolve` | Operator records `resolution` and `payCourier` after reviewing the case; chain must confirm final disposition |

Recipient tokens are hashed in PostgreSQL. The standalone `/recipient/:id` page is connected to the live recipient API: it reads and immediately removes the URL fragment, keeps the token only in memory, and sends it in the POST JSON. It requires an explicit receipt checkbox or an issue description and displays success only after a confirmed API response. Reloading requires reopening the original link. The page is excluded from indexing and sends no referrer. Links cannot list other jobs or expose private addresses. The demo dashboard remains independent of this live flow.

Settlement is operator-triggered in this pilot; there is no automatically configured background scheduler. An authorized worker can use the same settlement service and must keep its operator credential secret. Recipient confirmation leaves `DELIVERY_CONFIRMED` visible until settlement completes. Failed attempts persist `PAYOUT_RETRY`. Only a validated on-chain payment event produces `PAID` and its digest.

## Consistency, recovery, and privacy

Job mutations take PostgreSQL row locks and an application advisory lock. This intentionally serializes the closed pilot's job mutations because they share one operator Sui gas wallet; use independent gas coin management before increasing throughput. Assignment generations prevent a former courier's acceptance/pickup records from authorizing a subsequent assignment. Replay identifiers remain globally unique even after cancellation. Uniqueness and continuity identifiers have separate scopes. Audit events are append-only through a database trigger.

Sui mutations reconcile existing state and confirmed events before resubmitting. A crash after an on-chain success is therefore retried against observed state; payout is never blindly repeated. A failed on-chain dispute synchronization still leaves the database in `DISPUTED`, blocking automatic settlement. An operator must synchronize/reconcile chain state before resolution. If a transaction already paid before a dispute arrived, it cannot be reversed and the recorded chain outcome must take precedence.

If World ID or a wallet is lost mid-job, suspend the courier (`account_status = 'suspended'` or `'revoked'`), revoke login sessions, open a case, and stop automatic progress. Review the physical custody and actual chain state under the pilot's recovery policy. Do not replace `world_session_id` or the accepted job's `payout_address`. A replacement account must enroll afresh. Operator resolution must be explicit and audited. A crash during World verification may require a new request or operator reconciliation; do not bypass replay enforcement to make a retry succeed.

Keep database backups encrypted and restrict session IDs, addresses, contact fields, and dispute reasons to need-to-know staff. No external evidence-upload service is configured. Do not place secrets, addresses, contact details, or World data in on-chain job references or application logs. Before real deliveries, publish parcel restrictions, cancellation terms, liability/insurance terms, local legal policy, and a retention/deletion policy. Recommended closed-pilot retention is to erase private addresses/contact details after 30 days unless an open case requires retention; retain only the minimum financial/audit metadata required by applicable policy. Schedule and test that cleanup before public launch; the application does not silently delete evidence from open cases.

Expired rate-limit buckets and spent wallet/handoff request contexts can be pruned by an administrative task after the agreed retention period; never prune replay identifiers while their proofs could be accepted. The audit trigger blocks updates and deletes, so any legally required audit erasure must follow a controlled administrative process.

## Verification

`npm test` runs negative-path domain tests. They check old badges cannot authorize jobs, wrong account/job/stage/session/environment rejection, expired/reused requests, both handoff gates, suspended accounts, replay canonicalization, and cookie signature integrity.

For real PostgreSQL constraint/concurrency verification, provision an **empty disposable database**, then run `TEST_DATABASE_URL=postgres://... npx tsx --test tests/server/database.test.ts`. This test applies the migration and checks exclusive concurrent assignment, replay-triggered transactional rollback, one settlement per job, and immutable audit events. It skips if no test URL is supplied. It never calls World or moves funds.

An actual staging acceptance proof, pickup proof, funded Sui escrow, and paid testnet receipt require your credentials and accounts. Those end-to-end checks are intentionally not claimed by these local tests.
