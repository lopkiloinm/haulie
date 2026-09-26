import type { Metadata } from "next";
import { connection } from "next/server";
import { CustodyRecords } from "@/components/custody-records";
import { custodyPackageId, loadCustodyRecords } from "@/lib/sui/custody";

export const metadata: Metadata = {
  title: "On-chain custody · Haulie",
  description:
    "Parcel custody and courier-fee settlement, read live from the Haulie escrow on Sui testnet.",
};

export default async function Page() {
  await connection();
  const packageId = custodyPackageId();
  const records = await loadCustodyRecords(packageId).catch((error) => {
    console.error("Custody record query failed", error);
    return null;
  });
  return <CustodyRecords packageId={packageId} records={records} />;
}
