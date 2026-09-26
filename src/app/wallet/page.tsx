import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { SuiWallet } from "@/components/sui-wallet";
import "@/components/sui-wallet.css";
export const metadata: Metadata = { title: "Sui wallet · Haulie" };
export default function WalletPage() {
  return (
    <main className="wallet-page">
      <nav className="wallet-page-nav" aria-label="Wallet navigation">
        <Link href="/courier">
          <ArrowLeft size={16} /> Back to Haulie
        </Link>
        <Link href="/world-sandbox">
          World verification <ArrowUpRight size={16} />
        </Link>
      </nav>
      <SuiWallet standalone />
    </main>
  );
}
