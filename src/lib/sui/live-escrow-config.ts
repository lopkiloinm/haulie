/** Public testnet deployment (contracts/haulie/README.md). Safe to ship to browsers. */
export const LIVE_ESCROW = {
  network: "testnet",
  packageId:
    "0xd5912d65474abd188664416a95a539da959aa7ca14cc746b7ddc21ca0becce5e",
  operatorCapId:
    "0x356b99581bc5290df524773c8ddf757b0ed21f73aa188154653aca1592435176",
  configId:
    "0xa47f20718a002192dbb598efa093b23ccdfa3b85561be829568613bcf260dbd0",
  coinType: "0x2::sui::SUI",
} as const;

/** Faucet drips are 1 SUI, so a 6.50 fee escrows 0.0065 SUI. */
export const MIST_PER_FEE_UNIT = 1_000_000;

export function feeInMist(fee: number): bigint {
  return BigInt(Math.round(fee * MIST_PER_FEE_UNIT));
}

export function formatSui(mist: bigint | string): string {
  const value = BigInt(mist);
  const fraction = (value % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${value / 1_000_000_000n}${fraction ? `.${fraction}` : ""} SUI`;
}

export function jobReferenceInput(jobId: string): string {
  return `haulie:job:${jobId}`;
}

export function handoffMessage(jobId: string, escrowId: string): string {
  return [
    "Haulie parcel handoff",
    `Delivery: ${jobId}`,
    `Escrow: ${escrowId}`,
    "I handed this parcel to the assigned courier.",
  ].join("\n");
}

export const suiscan = (kind: "tx" | "object" | "account", id: string) =>
  `https://suiscan.xyz/testnet/${kind}/${id}`;
