# Haulie

**Haulie is local delivery where couriers re-verify with World ID at every handoff and get paid the moment a parcel arrives, from a per-parcel escrow on Sui that records the parcel's custody on-chain.**

**Deployed app:** https://haulie-chi.vercel.app · [Courier workspace](https://haulie-chi.vercel.app/courier) · [On-chain custody](https://haulie-chi.vercel.app/custody)

## Team

- Martin Liu: GitHub [@lopkiloinm](https://github.com/lopkiloinm)

## Why Haulie

**Identity checks are heavy and repetitive.** Delivery and gig platforms ask couriers to upload a driver's license or passport, then keep proving it's really them with selfie checks, because accounts get shared and rented: one verified person signs up and someone else does the deliveries. Every check collects sensitive personal data and adds friction, yet it only proves that someone passed a check at some point, not that the same person is doing this job now.

World ID answers that recurring question ("is this the same unique, verified human?") without photographing a document again. The courier approves a fresh World ID check on their phone in seconds, and Haulie learns only that the same verified human is present: no name, document number, or photo. Haulie asks for it where it matters, at acceptance and again at pickup, so a borrowed account can't pass those gates. It doesn't replace legal ID where the law requires one; it removes repeated document checks from the everyday workflow.

**Payouts are slow and costly.** Couriers are usually paid weekly, bank transfers take a few more business days, and getting paid sooner usually costs an instant-cashout fee. Card and bank rails make small, frequent payouts expensive, so platforms batch them.

On Sui, each delivery has its own escrow. When the recipient confirms receipt, the fee goes straight to the courier's wallet in one transaction that finalizes in about a second. Gas is a fraction of a cent (our confirm-and-release transaction used about 0.002 testnet SUI), so paying per delivery is cheap enough to do every time, and Sui's throughput supports marketplace volume. There's no payout schedule, no three-day wait, and no fee for getting paid now. Merchants lock funds before the job is offered and can refund an unassigned job from their own wallet.

## How it works

1. The merchant locks the courier fee in a Sui escrow before the job is offered.
2. The courier accepts only after a fresh World ID check.
3. At pickup, the courier verifies again with the same World identity, and the merchant signs the handoff with the wallet that funded the escrow.
4. The recipient confirms receipt, and the escrow pays the courier's wallet immediately.

The demo runs around Toranomon Hills Forum in Tokyo. See [Deliver with a real SUI fee](#deliver-with-a-real-sui-fee) to try it.

## Parcels as on-chain real-world assets (Curvegrid: supply chain RWA)

A delivery is a real-world asset in motion: a physical parcel whose holder changes, plus money that should move only when custody rules are met. Haulie represents each shipment as its own shared `Escrow` object on Sui ([`contracts/haulie/sources/escrow.move`](contracts/haulie/sources/escrow.move)). That object is the parcel's digital twin: it holds the value tied to the shipment (the courier fee), records who holds the parcel, and enforces what can happen next.

- **Movement and custody:** each handoff is an on-chain transition. Funded means the merchant holds the parcel, picked up means the courier does, and delivery confirmed means the recipient does.
- **Provenance:** every transition emits an `EscrowEvent` with its transaction, signer, and wallet, giving each parcel a public, tamper-evident chain of custody that anyone can audit on SuiScan without trusting Haulie's database.
- **Settlement:** the fee can't be released until pickup and delivery are confirmed, and release pays exactly the courier wallet snapshotted at assignment, once.
- **Programmable asset controls:** only the operator capability can advance custody; the payout wallet can't be redirected after assignment; the merchant can freeze funds with a dispute or refund an unassigned job without the operator; release and refund are exactly-once and terminal. Off-chain, each custody step needs its own approval: a fresh World ID check, the funding merchant's wallet signature, and a one-time recipient token.
- **Compliance-aware privacy:** the chain stores only a SHA-256 job reference and public wallet addresses. Street addresses, contacts, photos, and World identifiers stay off-chain.

This matches Curvegrid's **Supply Chain Assets** idea (track movement, custody, provenance, and settlement by representing commercial goods on-chain) and its **Programmable Asset Controls** idea (permissions and approval workflows around how an asset moves).

[/custody](https://haulie-chi.vercel.app/custody) reads those events **live from Sui testnet** through Sui GraphQL ([`src/lib/sui/custody.ts`](src/lib/sui/custody.ts)). It groups them per parcel, links each hashed job reference to its order, and shows where the parcel and the fee are now, with SuiScan links for every transaction. New escrows appear automatically; nothing on the page is hard-coded.

The package is published on testnet at [`0xd5912d65…ce5e`](https://suiscan.xyz/testnet/object/0xd5912d65474abd188664416a95a539da959aa7ca14cc746b7ddc21ca0becce5e). Parcels that have moved through it include HL-1044 (delivered and paid), HL-1043 (disputed after delivery, then resolved and paid), HL-1045 (picked up, in transit), a merchant refund, and HL-1046, a live delivery completed in the app and paid out on Sui. Fees are **testnet SUI standing in for USDC**, because the demo wallets hold no testnet USDC. The contract is coin-generic, and a native testnet USDC configuration (`0xcede1ede…dc65`) is also published for the live backend.

This is **operator-attested delivery**: the chain enforces the order of custody and payment and records who authorized each step, but it cannot prove that a physical handoff happened. Haulie's backend attests to those handoffs after World ID and merchant or recipient confirmations.

**MultiBaas:** not used. Haulie is built on Sui, and MultiBaas targets EVM chains; we used the Sui TypeScript SDK (gRPC) for transactions and Sui GraphQL for event queries instead.

### Reproduce the on-chain record

Requires the [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) (to compile) and testnet SUI for gas. The Sui CLI's own `publish` still uses JSON-RPC, which public fullnodes have retired, so the scripts use the SDK over gRPC.

```sh
sui move test --path contracts/haulie        # 15 Move tests
sui move build --path contracts/haulie
# .env.sui.local: SUI_OPERATOR_PRIVATE_KEY, SUI_DEMO_MERCHANT_PRIVATE_KEY,
# SUI_DEMO_COURIER_PRIVATE_KEY (Ed25519 suiprivkey…, testnet only, never commit)
npx tsx --env-file=.env.sui.local scripts/publish-escrow.mts
# append the printed SUI_ESCROW_PACKAGE_ID, SUI_OPERATOR_CAP_ID,
# SUI_ESCROW_CONFIG_ID and SUI_DEMO_CONFIG_ID to .env.sui.local, then:
npx tsx --env-file=.env.sui.local scripts/custody-demo.mts
```

Set `SUI_ESCROW_PACKAGE_ID` on the deployment to point `/custody` at a different package. Custody parsing is covered by [`tests/custody.test.ts`](tests/custody.test.ts) (`npm test`).

## What is deployed

The courier workspace opens on an interactive OpenStreetMap map with available and assigned deliveries alongside it. Selecting a delivery highlights its pickup and drop-off areas. World ID and the Sui wallet share one Connections panel; acceptance and pickup return to the map after server-validated World authentication. On smaller screens, delivery details sit below the map and Connections can be expanded when needed.

The public app is a **test workspace**. World uses its official sandbox with test identities, and the real wallet integration operates on Sui testnet. Delivery records remain browser-scoped sample orders. Their fees are simulated unless the merchant locks a real SUI fee in the testnet escrow ([below](#deliver-with-a-real-sui-fee)). Direct signed wallet transfers are a separate operation. Switching workspaces does not authenticate a live merchant, courier, recipient, or operator account.

Merchant, recipient, and operator views retain delivery creation, timelines, handoff and receipt confirmation, disputes, settlement retries, history, and CSV exports. The PWA includes installable icons and an offline fallback. Map markers show approximate neighborhood centers, not geocoded addresses, courier tracking, or driving directions; location access is requested only when the user chooses it.

## Run locally

Use Node.js 22:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. No environment variables are required to browse the test workspace. Official World verification requires the server credentials and registered callback described in [World configuration](docs/world-sandbox.md#configuration); an unconfigured deployment leaves verification unavailable. Wallet connection requires a compatible Sui wallet.

Settings includes **Reset workspace** for local deliveries and preferences. This does not clear the separate World session: an existing verified record can be projected back onto the board until its assignment is released or the session expires.

## Courier workspace

The courier map opens at **Toranomon Hills Forum, Tokyo**, with sample delivery routes around the venue. **Find my location** opts into browser location and centers the map on the device’s coordinates; **Back to Toranomon Hills Forum** restores the venue view. Available deliveries default to pickups within 25 km of the selected venue or device location, and **All areas** shows the other existing deliveries. If location access fails, the map keeps the Forum view and offers a retry. Device location stays in memory, and its watch stops when leaving the map or returning to the venue. Pan/zoom survives status refreshes and resizing.

Previously saved San Francisco sample routes move to the Forum area without resetting their assignments, World checks, wallet preferences, or delivery history. Custom deliveries and edited route fields remain unchanged.

Choose **Courier** from the sidebar workspace menu, or visit [/courier](https://haulie-chi.vercel.app/courier). Open the navigation drawer on mobile. Search available deliveries, select a map marker or delivery card, and review the areas, fee, and window. **Assigned** and **My deliveries** show this workspace's courier assignments; history, notifications, and exports use the same scope.

Acceptance snapshots the connected Sui address as the delivery's payout preference. A validated World callback projects the browser-scoped acceptance onto the local board, removes the offer from Available, and selects it under Assigned. Pickup requires a separate fresh check with the same World identity. Query strings and local state do not authorize either provider action or a Sui payment.

The wallet preference stays fixed if the connected account changes. An older World record without a wallet can attach one once through **Use this wallet**; this preserves the verified record rather than repeating acceptance. The address preference is not cryptographic proof of wallet ownership. **Cancel assignment** releases the World record before pickup verification, returns the local offer, and requires fresh acceptance next time. Release is rejected after World pickup verification.

## Deliver with a real SUI fee

Any open sample order (for example HL-1046) can carry a real courier fee in the testnet escrow. Fees are small so a 1 SUI faucet drip covers many deliveries: a 5.50 fee escrows **0.0055 SUI**. Get testnet SUI at [faucet.sui.io](https://faucet.sui.io/).

1. **Merchant funds.** On the Merchant workspace, open the delivery, connect a Sui wallet, and select **Lock 0.0055 SUI fee on Sui**. The merchant's wallet signs `fund`; the new escrow appears on [/custody](https://haulie-chi.vercel.app/custody).
2. **Courier accepts with World.** On the courier map, accept the delivery and complete World. The server assigns the escrow to the payout wallet recorded in the World-verified session.
3. **Courier verifies pickup with World.**
4. **Merchant signs the handoff.** The merchant wallet that funded the escrow signs a handoff message. The server checks that signature and the World pickup record, calls `confirm_pickup`, and returns a one-time receipt token to the merchant.
5. **Recipient confirms.** The token authorizes `confirm_delivery` and `release` in one transaction, which pays the courier's wallet. The delivery shows **Paid on Sui** with its payout transaction.

Before assignment, the merchant can cancel and refund from their own wallet (`merchant_refund`). Before pickup, the courier can cancel, which unassigns the escrow on-chain. The operator key pays gas for its steps and is a server-only Vercel variable ([`src/app/api/escrow/[operation]/route.ts`](src/app/api/escrow/%5Boperation%5D/route.ts), [`src/lib/sui/live-escrow.ts`](src/lib/sui/live-escrow.ts)).

Trust boundaries in this test workspace:

- The operator acts only on server-verified evidence: the encrypted World session (acceptance, pickup, payout wallet), the funding merchant's wallet signature, and the HMAC receipt token. Local board state never authorizes a chain call.
- The World session lives in the courier's browser cookie, so the merchant's handoff must be signed in the same browser as the courier's pickup check. A multi-device marketplace needs the database-backed backend below.
- The receipt token goes to the merchant, who passes it to the recipient; a merchant can therefore release their own escrow early, but cannot pay anyone other than the assigned courier.
- Sample orders are shared, so any World-verified courier can accept any open escrow for them, as in a real marketplace. Disputes on on-chain fees are not exposed in the UI; they need the operator.

`scripts/check-live-escrow.mts` runs this entire flow against the deployed app with a scripted wallet and real World sandbox logins:

```sh
PLAYWRIGHT_BROWSERS_PATH=... npx tsx --env-file=.env.sui.local scripts/check-live-escrow.mts
```

## Complete a test delivery

1. Open the courier map, choose an available sample delivery, and connect a Sui wallet in Connections or the acceptance dialog.
2. Select **Accept delivery**, then **Continue with World**. After successful authentication, the app returns to the assigned delivery.
3. Select **Verify pickup** and complete another fresh World check with the same identity.
4. Select **Merchant**, then confirm the parcel handoff.
5. Select **Recipient**, acknowledge receipt, and confirm it.
6. Process the simulated payout. For a delivery without an on-chain fee, this changes only the local record and never invents an on-chain digest.

Official World actions currently support the bundled sample order IDs. New deliveries created in the merchant workspace remain local workflow records and cannot use the official courier verification flow yet. Other workspaces retain explicitly labeled local test verification controls.

An issue before payout freezes the local job until an **Operator** resolves it. A failed settlement preserves receipt confirmation for a retry. Existing verification cannot bypass a new stage, and a completed payout cannot be repeated.

## World verification

The courier map uses World's official OIDC sandbox; the standalone verifier remains at [/world-sandbox](https://haulie-chi.vercel.app/world-sandbox). The backend validates the authorization callback and ID token before recording acceptance or pickup in an encrypted HttpOnly session. These browser-scoped records expire after 24 hours and do not provide shared assignment exclusivity or durable settlement records. World sandbox identities are test identities, not production proof of humanity.

See [World setup, security boundaries, validation results, and integration debrief](docs/world-sandbox.md).

## Sui wallet

The shared Connections panel and [/wallet](https://haulie-chi.vercel.app/wallet) connect a real Sui Wallet Standard account through Mysten dApp Kit. The wallet reads SUI and native testnet USDC balances from Sui gRPC, supports exact-decimal transfers approved in the user's wallet, submits signed transactions to testnet, and links successful executions to SuiScan. Haulie does not request or store private keys.

This integration is fixed to **testnet**. Direct wallet transfers are separate from delivery fees and the escrow contract. Saving a wallet preference alongside World verification does not bind cryptographic wallet ownership to the verified identity; live courier payouts still require the authenticated wallet-challenge backend and durable delivery transactions.

Wallet discovery, connection, balance rendering, invalid recipients, rejected signing, decimal precision, overflow, and mobile layouts are tested. Public testnet balance reads were checked against the real network. A funded transfer smoke test was attempted, but the public faucet returned HTTP 429; successful live transfer execution is not yet verified. To run the test using a fresh, memory-only test key and faucet SUI:

```sh
SUI_LIVE_TEST=1 PLAYWRIGHT_BASE_URL=https://haulie-chi.vercel.app npx tsx scripts/check-sui-wallet.mts
```

Add `SUI_BALANCE_ONLY=1` to check real connection and balance reads without faucet funding. No test wallet is exposed by the deployed app.

References: [Mysten dApp Kit](https://sdk.mystenlabs.com/dapp-kit/getting-started/next-js), [Circle native USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses).

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run test:sui
npx playwright install chromium
npm run test:e2e
npm run build
```

The PostgreSQL test skips without a disposable `TEST_DATABASE_URL`; see [backend verification](database/README.md#verification). Move tests run with `sui move test --path contracts/haulie`. Browser tests cover the courier map, World and wallet integration boundaries, local delivery transitions, recovery paths, focus management, persistence, and mobile layout. Automated map checks use tile fixtures. Set `PLAYWRIGHT_BASE_URL` to test a deployed URL; the opt-in real World provider suite is documented in [World verification](docs/world-sandbox.md#verification-and-integration-debrief).

## Live integration foundations

The repository also includes a separate, fail-closed pilot backend:

- PostgreSQL constraints, row locks, replay records, immutable audit history, and signed HttpOnly pilot sessions.
- World ID 4 server-signed requests and backend proof verification.
- A compiled/tested Sui Move escrow plus native-USDC network validation, funding, assignment, dispute locks, refunds, and idempotent payment reconciliation.
- Limited-purpose recipient confirmation at `/recipient/[jobId]`, using a fragment token removed from the URL and retained only in memory.
- Authenticated APIs and SSE delivery events.

The public workspace's World sandbox and Sui wallet integrations are active, but its delivery board is **not connected to this PostgreSQL and escrow backend**. Configuration alone does not make the board a live marketplace. Live operation still requires connecting the authenticated IDKit-v4, wallet-challenge, and delivery APIs to the frontend; provisioning PostgreSQL and the separate World credentials; publishing the Sui testnet package; funding wallets; and completing end-to-end validation. Settlement is operator-triggered until an authenticated worker is configured. The escrow contract is published on Sui testnet, and the board can settle real SUI fees through it ([Deliver with a real SUI fee](#deliver-with-a-real-sui-fee)); that path uses the World session and signatures rather than this database backend.

See [backend setup and API](database/README.md), [Sui escrow setup](contracts/haulie/README.md), [.env.backend.example](.env.backend.example), and [.env.sui.example](.env.sui.example). Do not expose server secrets with `NEXT_PUBLIC_` prefixes. The backend never substitutes simulated proofs or funds when configuration is absent.

## Deploy to Vercel

```sh
npx vercel@latest --prod
```

The project uses Vercel's Next.js runtime and Node.js 22. Configure the server-only World sandbox environment variables and exact callback for the deployment as described in [World configuration](docs/world-sandbox.md#configuration). The map and local workflow remain accessible without those credentials. The separate live backend needs its own setup and validation above.

## Implementation

- [src/components/haulie-app.tsx](src/components/haulie-app.tsx) — workspace shell and World result reconciliation
- [src/components/courier-workspace.tsx](src/components/courier-workspace.tsx) and [courier-map.tsx](src/components/courier-map.tsx) — map, delivery selection, and responsive courier layout
- [src/components/workspace-connections.tsx](src/components/workspace-connections.tsx) — combined World and Sui controls
- [src/components/world-action-dialog.tsx](src/components/world-action-dialog.tsx) — acceptance, pickup, and legacy wallet attachment
- [src/components/delivery-detail.tsx](src/components/delivery-detail.tsx) — handoff timeline and local workflow controls
- [src/lib/demo.ts](src/lib/demo.ts) and [courier-world.ts](src/lib/courier-world.ts) — validated local state and projection of verified World records
- [src/lib/server/](src/lib/server/) — authenticated live services and IDKit verification
- [src/lib/sui/](src/lib/sui/) and [contracts/haulie/](contracts/haulie/) — on-chain escrow integration
- [src/app/api/escrow/[operation]/route.ts](src/app/api/escrow/%5Boperation%5D/route.ts), [src/lib/sui/live-escrow.ts](src/lib/sui/live-escrow.ts), and [src/lib/sui/escrow-client.ts](src/lib/sui/escrow-client.ts) — real SUI courier fees on the delivery board
- [src/lib/sui/custody.ts](src/lib/sui/custody.ts) and [src/components/custody-records.tsx](src/components/custody-records.tsx) — live on-chain custody record
- [scripts/publish-escrow.mts](scripts/publish-escrow.mts) and [scripts/custody-demo.mts](scripts/custody-demo.mts) — testnet publishing and sample parcel lifecycles
- [database/001_initial.sql](database/001_initial.sql) — durable state, constraints, and audit log
- [spec.md](spec.md) — original product requirements

The separate live design uses World ID for uniqueness and session continuity, not legal identity, background checks, parcel condition, or physical location. Its escrow model is operator-attested delivery with on-chain escrow.
