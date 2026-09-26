# Haulie

A responsive Next.js delivery workspace with World verification and a Sui wallet.

**Deployed app:** https://haulie-chi.vercel.app · [Courier workspace](https://haulie-chi.vercel.app/courier)

## What is deployed

The courier workspace opens on an interactive OpenStreetMap map with available and assigned deliveries alongside it. Selecting a delivery highlights its pickup and drop-off areas. World ID and the Sui wallet share one Connections panel; acceptance and pickup return to the map after server-validated World authentication. On smaller screens, delivery details sit below the map and Connections can be expanded when needed.

The public app is a **test workspace**. World uses its official sandbox with test identities, and the real wallet integration operates on Sui testnet. Delivery records remain browser-scoped sample orders; their fees, reservations, and settlement controls are simulated. Direct signed wallet transfers are a separate operation. Switching workspaces does not authenticate a live merchant, courier, recipient, or operator account.

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

## Complete a test delivery

1. Open the courier map, choose an available sample delivery, and connect a Sui wallet in Connections or the acceptance dialog.
2. Select **Accept delivery**, then **Continue with World**. After successful authentication, the app returns to the assigned delivery.
3. Select **Verify pickup** and complete another fresh World check with the same identity.
4. Select **Merchant**, then confirm the parcel handoff.
5. Select **Recipient**, acknowledge receipt, and confirm it.
6. Process the simulated payout. This changes the local delivery record and does not execute a wallet transfer or invent an on-chain digest.

Official World actions currently support the bundled sample order IDs. New deliveries created in the merchant workspace remain local workflow records and cannot use the official courier verification flow yet. Other workspaces retain explicitly labeled local test verification controls.

An issue before payout freezes the local job until an **Operator** resolves it. A failed settlement preserves receipt confirmation for a retry. Existing verification cannot bypass a new stage, and a completed payout cannot be repeated.

## World verification

The courier map uses World's official OIDC sandbox; the standalone verifier remains at [/world-sandbox](https://haulie-chi.vercel.app/world-sandbox). The backend validates the authorization callback and ID token before recording acceptance or pickup in an encrypted HttpOnly session. These browser-scoped records expire after 24 hours and do not provide shared assignment exclusivity or durable settlement records. World sandbox identities are test identities, not production proof of humanity.

See [World setup, security boundaries, validation results, and integration debrief](docs/world-sandbox.md).

## Sui wallet

The shared Connections panel and [/wallet](https://haulie-chi.vercel.app/wallet) connect a real Sui Wallet Standard account through Mysten dApp Kit. The wallet reads SUI and native testnet USDC balances from Sui gRPC, supports exact-decimal transfers approved in the user's wallet, submits signed transactions to testnet, and links successful executions to SuiScan. Haulie does not request or store private keys.

This integration is fixed to **testnet**. Direct wallet transfers are separate from simulated delivery fees and the unpublished live escrow contract. Saving a wallet preference alongside World verification does not bind cryptographic wallet ownership to the verified identity; live courier payouts still require the authenticated wallet-challenge backend and durable delivery transactions.

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

The public workspace's World sandbox and Sui wallet integrations are active, but its delivery board is **not connected to this PostgreSQL and escrow backend**. Configuration alone does not make the board a live marketplace. Live operation still requires connecting the authenticated IDKit-v4, wallet-challenge, and delivery APIs to the frontend; provisioning PostgreSQL and the separate World credentials; publishing the Sui testnet package; funding wallets; and completing end-to-end validation. Settlement is operator-triggered until an authenticated worker is configured. The escrow contract has not been deployed to a live chain, and no delivery payout has been executed.

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
- [database/001_initial.sql](database/001_initial.sql) — durable state, constraints, and audit log
- [spec.md](spec.md) — original product requirements

The separate live design uses World ID for uniqueness and session continuity, not legal identity, background checks, parcel condition, or physical location. Its escrow model is operator-attested delivery with on-chain escrow.
