import type { Metadata } from "next";
import { WorldSandbox } from "@/components/world-sandbox";
export const metadata: Metadata = {
  title: "World sandbox · Haulie",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; result?: string }>;
}) {
  const query = await searchParams;
  return (
    <WorldSandbox
      initialJob={
        query.job && /^HL-104[3-8]$/.test(query.job) ? query.job : "HL-1046"
      }
      initialResult={query.result || ""}
    />
  );
}
