# Haulie delivery escrow

Haulie is **operator-attested delivery with on-chain escrow**. The Move contract enforces custody-state ordering, payout snapshots, dispute locks, operator authority, and a single terminal release or refund. World verification and physical handoff checks happen in the authenticated backend; the chain does not prove physical delivery.

## Validation

```sh
sui move test --path contracts/haulie
```

The package compiled and all 15 Move tests passed with `sui 1.53.2-homebrew`. Tests cover exact funding, funded refund, refund/release replay, early release, disputed release, pre-pickup reassignment, post-pickup cancellation rejection, fixed payout, and an unrelated operator capability. They mint a test-only SUI coin; production integrations accept Circle's network-specific native USDC type only.

`src/lib/sui/server.test.ts` has 10 adapter regression tests with all RPC methods mocked. They cover configuration/network/token rejection, exactly-once reconciliation, and disputes after a successful chain transaction whose database commit was lost. With the `server-only` marker dependency installed, run:

```sh
NODE_OPTIONS=--conditions=react-server npx tsx --test src/lib/sui/server.test.ts
```

## Testnet deployment

| Object | ID |
| --- | --- |
| Package | `0xd5912d65474abd188664416a95a539da959aa7ca14cc746b7ddc21ca0becce5e` |
| `OperatorCap` | `0x356b99581bc5290df524773c8ddf757b0ed21f73aa188154653aca1592435176` |
| `Config<native testnet USDC>` | `0xcede1ede19f214ad70dfb0503f567dbb6c8dc87d1e9aac4ffa55b7f050bddc65` |
| `Config<SUI>` (sample parcels only) | `0xa47f20718a002192dbb598efa093b23ccdfa3b85561be829568613bcf260dbd0` |

Published with `scripts/publish-escrow.mts` (digest `AZAwyyMm7npNsnMXZX3diin32UFGnrBezCpvwvkKMstW`) from a dedicated testnet operator key. `scripts/custody-demo.mts` ran three sample parcels through it; [/custody](https://haulie-chi.vercel.app/custody) reads their events live. Sui CLI 1.53's `publish` and `call` use JSON-RPC, which public fullnodes have retired; the scripts use the SDK over gRPC instead. The CLI commands below remain valid against a node that still serves JSON-RPC.

## Testnet setup

Use a dedicated testnet operator wallet with SUI gas. Run these commands deliberately with your intended active Sui environment and wallet:

```sh
sui client switch --env testnet
sui client publish --gas-budget 100000000 contracts/haulie
```

Record the published package ID and the `OperatorCap` object owned by the publisher. Create the immutable, USDC-typed configuration:

```sh
sui client call \
  --package YOUR_PACKAGE_ID \
  --module escrow \
  --function create_config \
  --type-args 0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC \
  --args YOUR_OPERATOR_CAP_ID \
  --gas-budget 50000000
```

Record the resulting `Config<USDC>` ID. Populate the server-only variables in `.env.sui.example` on Vercel. The adapter checks the RPC genesis chain, immutable configuration type, capability ID, and capability owner on each operation. Missing configuration disables live escrow. The operator key must be an Ed25519 `suiprivkey...`, never a browser environment variable.

Merchants need testnet native USDC and SUI gas in their own wallets. `prepareEscrowFunding` returns a serialized programmable transaction, which the merchant wallet builds and signs. It sources the exact USDC amount and funds a new shared job escrow. Pass the resulting escrow ID and actual transaction digest to `confirmEscrowFunding`. The backend must associate each object ID with only one job.

## States and events

| State code | Meaning | Permitted next states |
| --- | --- | --- |
| 0 | Funded | Assigned, refunded |
| 1 | Assigned | Funded after unassignment, picked up, disputed |
| 2 | Picked up | Delivery confirmed, disputed |
| 3 | Delivery confirmed | Paid, disputed |
| 4 | Disputed | Paid or refunded by explicit operator resolution |
| 5 | Paid | Terminal |
| 6 | Refunded | Terminal |

Every transition emits `EscrowEvent` with its state code as `kind`; unassignment emits kind `7`. Events contain an escrow ID, 32-byte non-sensitive job reference, amount, and public recipient wallet. Job references are SHA-256 of `haulie:job:` plus a random database job ID. Never put addresses, photos, contacts, World sessions, or nullifiers in chain inputs.

The terminal escrow object remains available with a zero balance. The server confirms a successful transaction **and** the expected event before returning a digest. If a process crashes after the chain transaction, repeating the same operation reads its target state and verifies its previous transaction instead of paying again. The backend must retain a durable job lock around these calls and serialize use of the shared operator gas wallet across server instances. A gas/RPC failure should remain pending and be retried by reconciliation.

## Integration references

- [Sui gRPC client](https://sdk.mystenlabs.com/sui/clients/grpc): supported transport used by the TypeScript adapter.
- [Sui data queries](https://sdk.mystenlabs.com/sui/clients/querying): BCS parsing and transaction/event verification.
- [Circle native USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses): network-specific allowlist in `src/lib/sui/types.ts`.

Before accepting real funds, review operator key management, upgrade authority, withdrawal/dispute policy, monitoring, and the contract independently. Sample testnet payouts have executed through the published package; a payout driven by the delivery app still requires the operator credentials on the server, funded merchant wallets, World staging configuration, and a configured database.
