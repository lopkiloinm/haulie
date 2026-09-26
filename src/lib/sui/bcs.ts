import { bcs } from "@mysten/sui/bcs";

// Struct field order must match contracts/haulie/sources/escrow.move.
// UID and ID each encode to one address; Balance<T> encodes to one u64.
export const EscrowBcs = bcs.struct("Escrow", {
  id: bcs.Address,
  config_id: bcs.Address,
  operator_cap: bcs.Address,
  job_ref: bcs.vector(bcs.u8()),
  merchant: bcs.Address,
  amount: bcs.u64(),
  funds: bcs.u64(),
  payout: bcs.Address,
  state: bcs.u8(),
});

export const ConfigBcs = bcs.struct("Config", {
  id: bcs.Address,
  operator_cap: bcs.Address,
});

export const EscrowEventBcs = bcs.struct("EscrowEvent", {
  escrow_id: bcs.Address,
  job_ref: bcs.vector(bcs.u8()),
  kind: bcs.u8(),
  amount: bcs.u64(),
  recipient: bcs.Address,
});
