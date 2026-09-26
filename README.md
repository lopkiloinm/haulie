# Haulie

A responsive Next.js delivery marketplace with a fresh human check at every handoff.

**Live demo:** https://haulie-chi.vercel.app

## What is deployed

The public website is an **interactive demo**. It includes merchant, courier, recipient, and operator workspaces; delivery creation and filtering; a tracking timeline; two independent courier verification gates; merchant and recipient confirmations; disputes; settlement retries; wallet history; CSV exports; and saved browser-local demo state. Desktop delivery tables become compact cards on phones. The PWA includes installable icons and an offline fallback.

**Demo checks and payments are simulated.** There are no real World ID proofs, wallet connections, escrow funds, or transaction digests in the public dashboard. Sample maps and courier profiles are illustrative. Switching roles demonstrates the workflow; it does not authenticate a live account.

## Run locally

Use Node.js 22:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Demo settings include a reset action. No environment variables are required for the demo.

## Courier workspace

Choose **Courier** from the sidebar workspace menu (open the navigation drawer on mobile), or visit [/courier](https://haulie-chi.vercel.app/courier). Browse and search funded offers, inspect the route, fee and window, then choose **Accept delivery**. The fresh demo check assigns the job to Jamie Chen, removes it from the feed, and adds it to **My deliveries**. Courier lists, earnings, notifications and exports show only this courier’s jobs. Cancellation before handoff returns the funded offer and requires new verification on reacceptance.

## Rehearse a delivery

1. Select **New delivery**, enter sample details, and reserve demo funds.
2. In the delivery dialog, select **Courier** and verify to accept.
3. Complete a second fresh demo verification for pickup.
4. Select **Merchant**, then confirm the parcel handoff.
5. Select **Recipient**, acknowledge receipt, and confirm it.
6. Process the demo payout. A successful simulated result is explicitly labeled; no on-chain digest is invented.

Try an issue before payout to freeze the job, then resolve it as **Operator**. Try a failed settlement to see receipt confirmation survive a retry. Existing verification cannot bypass a new stage, and a completed payout cannot be repeated.

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

The PostgreSQL test skips without a disposable `TEST_DATABASE_URL`; see [backend verification](database/README.md#verification). Move tests run with `sui move test --path contracts/haulie`. Browser tests cover the full demo, recovery paths, focus management, persistence, and mobile layout. Set `PLAYWRIGHT_BASE_URL` to test a deployed URL.

## Live integration foundations

The repository also includes a separate, fail-closed pilot backend:

- PostgreSQL constraints, row locks, replay records, immutable audit history, and signed HttpOnly pilot sessions.
- World ID 4 server-signed requests and backend proof verification.
- A compiled/tested Sui Move escrow plus native-USDC network validation, funding, assignment, dispute locks, refunds, and idempotent payment reconciliation.
- Limited-purpose recipient confirmation at `/recipient/[jobId]`, using a fragment token removed from the URL and retained only in memory.
- Authenticated APIs and SSE delivery events.

These APIs are **not connected to the demo dashboard**. Configuration alone does not turn the dashboard into a live marketplace. Live operation still requires frontend IDKit/wallet/API integration, PostgreSQL provisioning, World staging credentials, a published Sui testnet package and funded wallets, and staging end-to-end validation. Settlement is operator-triggered until an authenticated worker is configured. No live-chain deployment or real payout is claimed.

See [backend setup and API](database/README.md), [Sui escrow setup](contracts/haulie/README.md), `.env.backend.example`, and `.env.sui.example`. Do not expose server secrets with `NEXT_PUBLIC_` prefixes. The backend never substitutes simulated proofs or funds when configuration is absent.

## Deploy to Vercel

```sh
npx vercel@latest --prod
```

The project uses Vercel's Next.js runtime and Node.js 22. Add live credentials only after separately completing the integration checklist above. The demonstration works without them.

## Implementation

- `src/components/haulie-app.tsx` — responsive workspaces and dashboard
- `src/components/delivery-detail.tsx` — handoff timeline and demo controls
- `src/lib/demo.ts` — validated local state and guarded demo transitions
- `src/lib/server/` — authenticated live services and World verification
- `src/lib/sui/` and `contracts/haulie/` — on-chain escrow integration
- `database/001_initial.sql` — durable state, constraints, audit log
- `spec.md` — original product requirements

World ID establishes uniqueness and session continuity, not legal identity, background checks, parcel condition, or physical location. The live escrow model is operator-attested delivery with on-chain escrow.
