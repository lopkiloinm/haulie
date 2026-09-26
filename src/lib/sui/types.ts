/** Circle's native USDC types; bridged representations are intentionally rejected.
 * Source: https://developers.circle.com/stablecoins/usdc-contract-addresses */
export const NATIVE_USDC = {
  mainnet:
    "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  testnet:
    "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
} as const;

export type SuiNetwork = keyof typeof NATIVE_USDC;
export const ESCROW_STATE = {
  FUNDED: 0,
  ASSIGNED: 1,
  PICKED_UP: 2,
  DELIVERY_CONFIRMED: 3,
  DISPUTED: 4,
  PAID: 5,
  REFUNDED: 6,
} as const;

export type EscrowReference = { escrowId: string; jobId: string };
export type EscrowAssignment = EscrowReference & { payoutAddress: string };
export type EscrowSettlement = EscrowAssignment & { amount: string };
export type EscrowReceipt = { digest: string; reconciled: boolean };
