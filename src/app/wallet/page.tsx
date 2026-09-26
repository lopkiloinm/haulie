import type { Metadata } from "next";
import Link from "next/link";
import { SuiWallet } from "@/components/sui-wallet";
export const metadata: Metadata = { title: "Sui wallet · Haulie" };
export default function WalletPage() {
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px" }}>
      <Link
        href="/courier"
        style={{
          display: "inline-block",
          color: "#42623d",
          marginBottom: 24,
          fontSize: 13,
        }}
      >
        ← Back to Haulie
      </Link>
      <SuiWallet />
    </main>
  );
}
